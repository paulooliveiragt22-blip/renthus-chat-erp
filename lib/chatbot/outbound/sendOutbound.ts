/**
 * Envio de mensagem proativa com persistência em `whatsapp_messages`.
 *
 * `botSendButtons` não grava no histórico: para mensagem proativa isso deixaria
 * o operador vendo o cliente responder a uma bolha que não existe na inbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveButtons, sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { sendTemplateMessage } from "@/lib/whatsapp-templates/sendTemplateMessage";
import type { OutboundJobPayload } from "./types";

export interface SendOutboundResult {
    ok: boolean;
    providerMessageId?: string | null;
    error?: string;
}

export async function sendOutboundPayload(params: {
    admin: SupabaseClient;
    threadId: string;
    phoneE164: string;
    payload: OutboundJobPayload;
    waConfig: WaConfig;
}): Promise<SendOutboundResult> {
    const { admin, threadId, phoneE164, payload, waConfig } = params;
    const fromAddr = waConfig.phoneNumberId ? `whatsapp:${waConfig.phoneNumberId}` : "whatsapp";
    const preview =
        payload.kind === "template"
            ? payload.text || `[template:${payload.templateName}]`
            : payload.text;

    const { data: msgRow } = await admin
        .from("whatsapp_messages")
        .insert({
            thread_id: threadId,
            direction: "outbound",
            channel: "whatsapp",
            from_addr: fromAddr,
            to_addr: phoneE164,
            body: preview,
            num_media: 0,
            status: "pending",
            sender_type: "bot",
        })
        .select("id")
        .single();

    const result =
        payload.kind === "template"
            ? await sendTemplateMessage({
                  toE164: phoneE164,
                  templateName: payload.templateName,
                  languageCode: payload.language,
                  bodyParameters: payload.bodyParams,
                  config: waConfig,
              })
            : payload.kind === "buttons"
              ? await sendInteractiveButtons(phoneE164, payload.text, payload.buttons, waConfig)
              : await sendWhatsAppMessage(phoneE164, payload.text, waConfig);

    if (msgRow?.id) {
        await admin
            .from("whatsapp_messages")
            .update(
                result.ok
                    ? {
                          provider: "meta",
                          provider_message_id: result.messageId ?? null,
                          status: "sent",
                          raw_payload: {
                              sent_at: new Date().toISOString(),
                              proactive: true,
                              ...(payload.kind === "template"
                                  ? { template: payload.templateName }
                                  : {}),
                          },
                      }
                    : {
                          status: "failed",
                          error: String(result.error ?? "send_failed").slice(0, 500),
                      }
            )
            .eq("id", msgRow.id);
    }

    if (result.ok) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: preview.slice(0, 120),
            })
            .eq("id", threadId);
    }

    return {
        ok: result.ok,
        providerMessageId: result.messageId ?? null,
        error: result.error,
    };
}
