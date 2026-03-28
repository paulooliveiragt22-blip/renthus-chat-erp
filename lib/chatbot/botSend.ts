/**
 * lib/chatbot/botSend.ts
 *
 * Wrapper de envio de mensagens do chatbot que salva em whatsapp_messages
 * com sender_type = 'bot', tornando as mensagens visíveis no painel de chat.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage as sendViaService } from "../whatsapp/sendMessage";
import {
    sendInteractiveButtons as _sendInteractiveButtons,
    sendListMessage as _sendListMessage,
} from "../whatsapp/send";

// ─── Texto simples ─────────────────────────────────────────────────────────────

export async function botReply(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    text: string
): Promise<void> {
    const result = await sendViaService({
        admin,
        companyId,
        toPhone: phoneE164,
        text,
        threadId,
        senderType: "bot",
    });
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar mensagem:", result.error);
    }
}

// ─── Botões interativos ────────────────────────────────────────────────────────
// Envia os botões via send.ts (Meta API) e armazena o corpo como mensagem de bot.

export async function botSendButtons(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    body: string,
    buttons: { id: string; title: string }[]
): Promise<void> {
    // Salva corpo da mensagem no histórico
    await sendViaService({
        admin,
        companyId,
        toPhone: phoneE164,
        text: body,
        threadId,
        senderType: "bot",
    });
    // Envia os botões interativos via Meta API (sem persistência adicional)
    await _sendInteractiveButtons(phoneE164, body, buttons);
}

// ─── Lista interativa ──────────────────────────────────────────────────────────

export async function botSendList(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    bodyText: string,
    buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
    sectionTitle?: string
): Promise<void> {
    // Salva corpo da mensagem no histórico
    await sendViaService({
        admin,
        companyId,
        toPhone: phoneE164,
        text: bodyText,
        threadId,
        senderType: "bot",
    });
    // Envia a lista interativa via Meta API
    await _sendListMessage(phoneE164, bodyText, buttonLabel, rows, sectionTitle);
}
