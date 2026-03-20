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
    provider?: "meta";
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

    const provider: "meta" = "meta";

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
    const pm = (channel as any).provider_metadata ?? {};
    const phoneNumberId = pm.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    const fromPlaceholder = String(channel.from_identifier ?? `whatsapp:${phoneNumberId}`);
    const { data: msgRow, error: insErr } = await admin
        .from("whatsapp_messages")
        .insert({
            thread_id: resolvedThreadId,
            direction: "outbound",
            channel: "whatsapp",
            provider: null, // preenchido após envio
            provider_message_id: null,
            from_addr: fromPlaceholder || "whatsapp",
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

    // 4. Envio via Meta WhatsApp Cloud API
    let providerMessageId: string | null = null;
    let fromAddr = "";
    let toAddr = "";

    try {
        const token = pm.access_token ?? process.env.WHATSAPP_TOKEN!;
        const baseUrl = pm.base_url ?? process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0";
        const effectivePhoneNumberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID!;

        const res = await fetch(`${baseUrl}/${effectivePhoneNumberId}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: toPhone.replace("+", ""),
                type: "text",
                text: { body: text },
            }),
        });

        const json = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
            throw new Error("meta_send_failed: " + JSON.stringify(json));
        }

        providerMessageId = json?.messages?.[0]?.id ?? null;
        fromAddr = fromPlaceholder || (String(channel.from_identifier ?? `whatsapp:${effectivePhoneNumberId}`));
        toAddr = toPhone;

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
