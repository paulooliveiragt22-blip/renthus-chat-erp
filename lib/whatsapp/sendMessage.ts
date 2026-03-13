/**
 * lib/whatsapp/sendMessage.ts
 *
 * Função compartilhada para enviar mensagens WhatsApp via provider ativo.
 * Usada pelo chatbot (sem sessão HTTP) e pelo endpoint /api/whatsapp/send.
 *
 * Fluxo:
 *  1. Busca canal ativo da empresa
 *  2. Insere registro pendente em whatsapp_messages
 *  3. Envia via Twilio ou 360dialog
 *  4. Atualiza registro e preview da thread
 */

import twilio from "twilio";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SendMessageParams {
    admin: SupabaseClient;
    companyId: string;
    toPhone: string;       // E.164, ex: +5565999999999
    text: string;
    threadId?: string | null;
}

export interface SendMessageResult {
    ok: boolean;
    messageId?: string;
    providerMessageId?: string | null;
    provider?: "twilio" | "360dialog";
    error?: string;
}

export async function sendWhatsAppMessage(
    params: SendMessageParams
): Promise<SendMessageResult> {
    const { admin, companyId, toPhone, text, threadId } = params;

    // 1. Canal ativo da empresa
    const { data: channel, error: chErr } = await admin
        .from("whatsapp_channels")
        .select("id, provider, from_identifier, provider_metadata")
        .eq("company_id", companyId)
        .eq("status", "active")
        .maybeSingle();

    if (chErr || !channel) {
        return { ok: false, error: "no_active_channel" };
    }

    // 2. Resolve threadId se não fornecido
    let resolvedThreadId = threadId ?? null;
    if (!resolvedThreadId) {
        const { data: th } = await admin
            .from("whatsapp_threads")
            .select("id")
            .eq("company_id", companyId)
            .eq("phone_e164", toPhone)
            .maybeSingle();
        resolvedThreadId = th?.id ?? null;
    }

    // 3. Insere registro pendente
    const { data: msgRow, error: insErr } = await admin
        .from("whatsapp_messages")
        .insert({
            thread_id: resolvedThreadId,
            direction: "outbound",
            channel: "whatsapp",
            provider: null,               // preenchido após envio
            provider_message_id: null,
            from_addr: null,
            to_addr: toPhone,
            body: text,
            num_media: 0,
            status: "pending",
            raw_payload: null,
        })
        .select("id")
        .single();

    if (insErr || !msgRow?.id) {
        return { ok: false, error: "db_insert_failed: " + insErr?.message };
    }

    const messageId = msgRow.id;

    // 4. Envio via provider
    let providerMessageId: string | null = null;
    let fromAddr = "";
    let toAddr = "";
    const provider = channel.provider as "twilio" | "360dialog";

    try {
        if (provider === "twilio") {
            const accountSid = process.env.TWILIO_ACCOUNT_SID!;
            const authToken  = process.env.TWILIO_AUTH_TOKEN!;
            const from       = process.env.TWILIO_WHATSAPP_FROM!;

            const client = twilio(accountSid, authToken);
            const msg = await client.messages.create({
                from,
                to: `whatsapp:${toPhone}`,
                body: text,
            });

            providerMessageId = msg.sid;
            fromAddr = from;
            toAddr   = `whatsapp:${toPhone}`;

        } else {
            // 360dialog → Meta Graph API
            const token         = process.env.DIALOG_TOKEN!;
            const phoneNumberId = process.env.DIALOG_PHONE_NUMBER_ID!;
            const baseUrl       = process.env.DIALOG_BASE_URL ?? "https://graph.facebook.com/v20.0";

            const res = await fetch(`${baseUrl}/${phoneNumberId}/messages`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to:   toPhone.replace("+", ""),
                    type: "text",
                    text: { body: text },
                }),
            });

            const json = await res.json().catch(() => ({})) as any;
            if (!res.ok) {
                throw new Error("360dialog error: " + JSON.stringify(json));
            }

            providerMessageId = json?.messages?.[0]?.id ?? null;
            fromAddr = channel.from_identifier ?? "360dialog";
            toAddr   = toPhone;
        }

        // 5. Atualiza registro com dados do provider
        await admin.from("whatsapp_messages").update({
            provider,
            provider_message_id: providerMessageId,
            from_addr: fromAddr,
            to_addr:   toAddr,
            status:    "sent",
            raw_payload: {
                provider,
                provider_message_id: providerMessageId,
                sent_at: new Date().toISOString(),
            },
        }).eq("id", messageId);

        // 6. Atualiza preview da thread
        if (resolvedThreadId) {
            await admin.from("whatsapp_threads").update({
                last_message_at:      new Date().toISOString(),
                last_message_preview: text.slice(0, 120),
            }).eq("id", resolvedThreadId);
        }

        return { ok: true, messageId, providerMessageId, provider };

    } catch (err: any) {
        // Marca falha no registro
        await admin.from("whatsapp_messages").update({
            status:      "failed",
            raw_payload: { error: String(err?.message ?? err) },
        }).eq("id", messageId);

        return { ok: false, messageId, error: String(err?.message ?? err) };
    }
}
