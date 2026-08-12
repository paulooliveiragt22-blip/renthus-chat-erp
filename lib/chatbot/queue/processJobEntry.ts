import "server-only";
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { sendTypingIndicator, sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";
import { tryResolvePendingOrderConfirmation } from "@/src/pro/pipeline/resolvePendingOrderConfirmation";
import type { AdminClient, ChatbotQueueJobRow } from "./types";

const REACTIVATE_MSG =
    "😔 No momento não há atendentes disponíveis.\n" +
    "Mas não se preocupe — nosso assistente automático está de volta para te ajudar!\n\n" +
    "Digite qualquer mensagem para continuar seu pedido.";

// ─── Timeout de handover (P2: configurável por empresa) ───────────────────────
// Cache em memória por instância — reseta em cold start; suficiente pra evitar 1
// SELECT por job quando vários jobs da mesma empresa chegam em rajada.

const handoverTimeoutCache = new Map<string, { value: number; ts: number }>();

async function getHandoverTimeout(admin: AdminClient, companyId: string): Promise<number> {
    const cached = handoverTimeoutCache.get(companyId);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.value;

    const { data } = await admin
        .from("chatbots")
        .select("config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .maybeSingle();

    const cfg = data?.config as { handover_timeout_minutes?: unknown } | undefined;
    const minutes = Number(cfg?.handover_timeout_minutes ?? 5);
    const value = Number.isNaN(minutes) || minutes < 1 ? 5 : minutes;
    handoverTimeoutCache.set(companyId, { value, ts: Date.now() });
    return value;
}

/**
 * Pipeline de negócio de um job da fila: confirmação de pedido pendente → gate de
 * handover/reativação → "digitando..." → `processInboundMessage`. Sem `Request`/`NextResponse` —
 * testável isoladamente. Chamado só depois de `validateCronAuthorization` (rota) e do claim
 * atômico (RPC) — nunca deve ser exposto direto por uma rota sem esse gate.
 */
export async function processQueueJobEntry(admin: AdminClient, job: ChatbotQueueJobRow): Promise<void> {
    const {
        company_id,
        thread_id,
        phone_e164,
        message_id,
        body_text,
        profile_name,
        messaging_channel,
        channel_user_id,
    } = job;

    const messagingChannel =
        messaging_channel === "instagram" || messaging_channel === "messenger"
            ? messaging_channel
            : "whatsapp";
    const channelUserId = String(channel_user_id || phone_e164 || "").trim();

    // Carrega credenciais WhatsApp (só necessário para canal WA / reativação)
    const { data: channelRow } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("company_id", company_id)
        .eq("provider", "meta")
        .eq("status", "active")
        .maybeSingle();
    const channelMeta = channelRow?.provider_metadata as {
        catalog_flow_id?: string;
        status_flow_id?: string;
        address_register_flow_id?: string;
    } | null;
    if (process.env.NODE_ENV === "production" && messagingChannel === "whatsapp") {
        if (!channelRow) {
            throw new Error("missing_active_meta_whatsapp_channel");
        }
        const pid = String(channelRow.from_identifier ?? "").trim();
        const tok = resolveChannelAccessToken(channelRow).trim();
        if (!pid) throw new Error("whatsapp_channel_missing_phone_number_id");
        if (!tok) throw new Error("whatsapp_channel_missing_access_token");
    }

    const waConfig: WaConfig = {
        phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        accessToken: channelRow ? resolveChannelAccessToken(channelRow) : (process.env.WHATSAPP_TOKEN ?? ""),
    };
    const catalogFlowId = channelMeta?.catalog_flow_id ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    const statusFlowId = channelMeta?.status_flow_id ?? process.env.WHATSAPP_STATUS_FLOW_ID;
    const addressRegisterFlowId =
        channelMeta?.address_register_flow_id ?? process.env.WHATSAPP_ADDRESS_REGISTER_FLOW_ID;

    /**
     * Confirmação de pedido montado pelo atendente (whatsapp_order_confirmations): roda ANTES
     * do gate de handover porque funciona independente do bot estar ativo — o atendente pode
     * estar em atendimento humano e ainda assim o cliente confirma/cancela por CONFIRMAR/CANCELAR
     * sem IA nenhuma envolvida. Se resolveu (true), a mensagem já foi tratada — não passa pro
     * bot nem fica esperando handover expirar.
     */
    if (messagingChannel === "whatsapp" && phone_e164) {
        try {
            const handled = await tryResolvePendingOrderConfirmation({
                admin,
                companyId: company_id,
                threadId: thread_id,
                phoneE164: phone_e164,
                messageId: message_id ?? "",
                channelUserId,
                inboundText: body_text ?? "",
                waConfig,
            });
            if (handled) return;
        } catch (err) {
            console.error(
                "[process-queue] tryResolvePendingOrderConfirmation erro inesperado:",
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    // 1. Lê bot_active fresh (pode ter mudado desde que o job foi enfileirado)
    // Hardening 2026-08-11: filtro por company_id além de thread_id — thread_id já é
    // UUID pouco adivinhável, mas nenhuma query tenant-scoped deveria confiar só nisso.
    const { data: threadRow } = await admin
        .from("whatsapp_threads")
        .select("bot_active, handover_at")
        .eq("id", thread_id)
        .eq("company_id", company_id)
        .maybeSingle();

    if (threadRow?.bot_active === false) {
        // Verifica handover timeout (configurável via chatbots.config ou padrão 5min)
        const handoverAt = threadRow.handover_at ? new Date(threadRow.handover_at) : null;
        const timeoutMinutes = await getHandoverTimeout(admin, company_id);
        const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

        if (!handoverAt || handoverAt > cutoff) {
            // Handover ainda ativo → não processa
            console.log("[process-queue] bot inativo (handover recente), skipping:", thread_id);
            return;
        }

        // Handover expirado → reativa
        console.log("[process-queue] reativando bot após handover expirado:", thread_id);
        await admin
            .from("whatsapp_threads")
            .update({ bot_active: true, handover_at: null })
            .eq("id", thread_id)
            .eq("company_id", company_id);
        await admin
            .from("chatbot_sessions")
            .delete()
            .eq("thread_id", thread_id)
            .eq("company_id", company_id);
        if (messagingChannel === "whatsapp" && phone_e164) {
            await sendWhatsAppMessage(phone_e164, REACTIVATE_MSG, waConfig);
        } else if (messagingChannel === "instagram" || messagingChannel === "messenger") {
            const { MetaMessageGateway } = await import(
                "@/src/pro/adapters/meta/message.gateway.meta"
            );
            const gw = new MetaMessageGateway(admin, messagingChannel);
            await gw.send(
                {
                    companyId: company_id,
                    threadId: thread_id,
                    messageId: message_id ?? "",
                    phoneE164: phone_e164 || "",
                    messagingChannel,
                    channelUserId,
                },
                { kind: "text", text: REACTIVATE_MSG }
            );
        }
    }

    /**
     * "Digitando..." + marca a mensagem inbound como lida antes de rodar o pipeline.
     * Best-effort: nunca bloqueia nem falha o job por causa disso. A Meta encerra o
     * indicador ao enviarmos a resposta ou após 25s (cobre a maior parte do E2E com IA).
     * Só dispara quando o bot de fato vai processar/responder este job (após o gate
     * de handover acima) — evita "digitando" sem resposta em seguida.
     */
    if (messagingChannel === "whatsapp" && message_id) {
        try {
            const typingResult = await sendTypingIndicator(message_id, waConfig);
            if (!typingResult.ok) {
                console.warn("[process-queue] typing_indicator falhou:", typingResult.error);
            }
        } catch (err) {
            console.warn(
                "[process-queue] typing_indicator erro inesperado:",
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    // 2. Processa a mensagem
    await processInboundMessage({
        admin,
        companyId: company_id,
        threadId: thread_id,
        messageId: message_id ?? "",
        phoneE164: phone_e164 || "",
        channelUserId,
        messagingChannel,
        text: body_text,
        profileName: profile_name ?? null,
        waConfig: messagingChannel === "whatsapp" ? waConfig : undefined,
        catalogFlowId,
        statusFlowId,
        addressRegisterFlowId,
    });
}
