/**
 * lib/chatbot/botSend.ts
 *
 * Wrapper de envio de mensagens do chatbot que salva em whatsapp_messages
 * com sender_type = 'bot', tornando as mensagens visíveis no painel de chat.
 *
 * Todas as funções aceitam waConfig opcional para suporte multi-tenant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage as sendViaService } from "../whatsapp/sendMessage";
import {
    sendInteractiveButtons as _sendInteractiveButtons,
    sendListMessage        as _sendListMessage,
} from "../whatsapp/send";
import type { WaConfig } from "../whatsapp/send";

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
        toPhone:    phoneE164,
        text,
        threadId,
        senderType: "bot",
    });
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar mensagem:", result.error);
    }
}

// ─── Botões interativos ────────────────────────────────────────────────────────

export async function botSendButtons(
    _admin: SupabaseClient,
    _companyId: string,
    _threadId: string,
    phoneE164: string,
    body: string,
    buttons: { id: string; title: string }[],
    waConfig?: WaConfig
): Promise<void> {
    /** Uma só bolha: o interactive já leva o corpo; texto duplicado quebrava UX no WhatsApp. */
    await _sendInteractiveButtons(phoneE164, body, buttons, waConfig);
}

// ─── Lista interativa ──────────────────────────────────────────────────────────

export async function botSendList(
    _admin: SupabaseClient,
    _companyId: string,
    _threadId: string,
    phoneE164: string,
    bodyText: string,
    buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
    sectionTitle?: string,
    waConfig?: WaConfig
): Promise<void> {
    /** Lista interativa já inclui o corpo; evitar bolha de texto duplicada. */
    await _sendListMessage(phoneE164, bodyText, buttonLabel, rows, sectionTitle, waConfig);
}
