/**
 * src/pro/pipeline/resolvePendingOrderConfirmation.ts
 *
 * Fecha o loop do fluxo "atendente monta o carrinho → cliente confirma pelo
 * WhatsApp" (ver whatsapp_order_confirmations). Roda ANTES do gate de handover
 * em process-queue: funciona independente do bot estar ativo/inativo e não
 * usa IA — só regex determinística (CONFIRMAR/CANCELAR) + a mesma RPC de
 * criação de pedido que o bot já usa (`OrderServiceV2Adapter.createFromDraft`,
 * que revalida estoque/preço e chama `create_order_with_items`).
 *
 * Claim atômico (`UPDATE ... WHERE status='pending'`) evita duplo
 * processamento em retries/duplicidade de webhook: a segunda chamada não
 * encontra mais a linha em 'pending' e retorna false sem efeito.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, TenantRef } from "@/src/types/contracts";
import { OrderServiceV2Adapter } from "@/src/pro/adapters/order/order.service.v2";
import { sendAndPersistWaText } from "@/lib/whatsapp/sendAndPersist";
import type { WaConfig } from "@/lib/whatsapp/send";

const CONFIRM_RE = /^\s*(confirmar|confirmo|confirma|confirmado|isso|sim|ok|okay|1)\W*$/iu;
const CANCEL_RE = /^\s*(cancelar|cancela|cancelado|n[aã]o|nao|2)\W*$/iu;

const CONFIRMATION_TTL_MS = 60 * 60 * 1000;

export type PendingOrderConfirmationIntent = "confirm" | "cancel" | null;

/** Exportado para teste unitário direto (sem precisar montar admin client). */
export function detectPendingConfirmationIntent(text: string): PendingOrderConfirmationIntent {
    const t = (text ?? "").trim();
    if (!t) return null;
    if (CONFIRM_RE.test(t)) return "confirm";
    if (CANCEL_RE.test(t)) return "cancel";
    return null;
}

export async function tryResolvePendingOrderConfirmation(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    messageId: string;
    channelUserId?: string;
    inboundText: string;
    waConfig?: WaConfig;
}): Promise<boolean> {
    const { admin, companyId, threadId, phoneE164, messageId, channelUserId, inboundText, waConfig } = params;

    const intent = detectPendingConfirmationIntent(inboundText);
    if (!intent) return false;

    const { data: claimed, error: claimErr } = await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "processing" })
        .eq("thread_id", threadId)
        .eq("status", "pending")
        .select("id, draft, created_at, customer_id")
        .maybeSingle();

    if (claimErr) {
        console.error("[resolvePendingOrderConfirmation] claim failed:", claimErr.message);
        return false;
    }
    if (!claimed) return false;

    const confirmationId = String(claimed.id);
    const createdAtMs = new Date(String(claimed.created_at)).getTime();
    const isExpired = Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CONFIRMATION_TTL_MS;

    if (isExpired) {
        await admin
            .from("whatsapp_order_confirmations")
            .update({ status: "expired", resolved_at: new Date().toISOString() })
            .eq("id", confirmationId);
        await sendAndPersistWaText(admin, {
            threadId,
            phoneE164,
            waConfig,
            senderType: "bot",
            text: "Esse pedido expirou por falta de resposta. Fala com a gente que a gente monta de novo rapidinho. 🙂",
        });
        return true;
    }

    if (intent === "cancel") {
        await admin
            .from("whatsapp_order_confirmations")
            .update({ status: "cancelled", resolved_at: new Date().toISOString() })
            .eq("id", confirmationId);
        await sendAndPersistWaText(admin, {
            threadId,
            phoneE164,
            waConfig,
            senderType: "bot",
            text: "Tudo bem, pedido cancelado. Se quiser, é só chamar de novo por aqui. 🙂",
        });
        return true;
    }

    const draft = claimed.draft as OrderDraft;
    const tenant: TenantRef = {
        companyId,
        threadId,
        messageId,
        phoneE164,
        messagingChannel: "whatsapp",
        channelUserId: channelUserId || phoneE164,
    };

    const orderService = new OrderServiceV2Adapter(admin);
    const result = await orderService.createFromDraft({
        tenant,
        customerId: (claimed.customer_id as string | null) ?? "__missing_confirmation_customer__",
        draft,
        idempotencyKey: `whatsapp_order_confirmation:${confirmationId}`,
    });

    await admin
        .from("whatsapp_order_confirmations")
        .update({
            status: result.ok ? "confirmed" : "failed",
            order_id: result.ok ? result.orderId : null,
            resolved_at: new Date().toISOString(),
        })
        .eq("id", confirmationId);

    await sendAndPersistWaText(admin, {
        threadId,
        phoneE164,
        waConfig,
        senderType: "bot",
        text: result.customerMessage,
    });

    return true;
}
