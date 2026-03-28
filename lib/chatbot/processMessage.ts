/**
 * lib/chatbot/processMessage.ts
 *
 * Chatbot flows-only: qualquer mensagem recebida abre o Flow Catálogo.
 * Toda a lógica de catálogo, carrinho e checkout está em app/api/whatsapp/flows/route.ts.
 */

import type { ProcessMessageParams } from "./types";
import { getOrCreateSession, saveSession } from "./session";
import { sendFlowMessage, sendWhatsAppMessage } from "../whatsapp/send";

export type { ProcessMessageParams, CartItem, Session } from "./types";

const HANDOVER_RE = /\b(atendente|humano|suporte|falar com pessoa)\b/iu;

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, text, profileName, waConfig, catalogFlowId } = params;

    const input = text.trim();
    if (!input) return;

    // ── 1. Verifica chatbot ativo ─────────────────────────────────────────────
    const { data: botRows } = await admin
        .from("chatbots")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    if (!botRows?.length) return;

    // ── 2. Nome da empresa ────────────────────────────────────────────────────
    const { data: comp } = await admin
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
    const companyName = (comp?.name as string | null) ?? "nossa loja";

    // ── 3. Handover ───────────────────────────────────────────────────────────
    if (HANDOVER_RE.test(input)) {
        await admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId);
        await sendWhatsAppMessage(
            phoneE164,
            `🙋 Aguarde, transferindo para um atendente...`,
            waConfig
        );
        return;
    }

    // ── 4. Sessão ─────────────────────────────────────────────────────────────
    const session = await getOrCreateSession(admin, threadId, companyId);

    // Já está dentro de um flow em andamento — não envia novo CTA
    if (session.step === "awaiting_flow") return;

    // ── 5. Envia Flow CTA ─────────────────────────────────────────────────────
    const flowId = catalogFlowId ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    if (!flowId) {
        console.warn("[chatbot] WHATSAPP_CATALOG_FLOW_ID não configurado");
        return;
    }

    const greeting = profileName
        ? `Olá, *${profileName}*! 👋\n\nBem-vindo(a) ao *${companyName}*!\nToque no botão abaixo para ver o cardápio e fazer seu pedido.`
        : `Olá! 👋\n\nBem-vindo(a) ao *${companyName}*!\nToque no botão abaixo para ver o cardápio e fazer seu pedido.`;

    await sendFlowMessage(phoneE164, {
        flowToken: `${threadId}|${companyId}|catalog`,
        bodyText:  greeting,
        ctaLabel:  "Ver cardápio",
        flowId,
    }, waConfig);

    await saveSession(admin, threadId, companyId, {
        step:    "awaiting_flow",
        context: { flow_started_at: new Date().toISOString() },
    });
}
