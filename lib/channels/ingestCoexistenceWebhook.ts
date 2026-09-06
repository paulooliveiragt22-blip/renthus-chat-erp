import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    isBusinessSender,
    parseAccountUpdateEvent,
    parseHistoryMessages,
    parseMessageEchoes,
    type ParsedCoexistenceMessage,
} from "@/lib/channels/coexistenceWebhookParse";
import { toE164Phone, upsertWhatsappThread } from "@/lib/whatsapp/upsertWhatsappThread";

type ActiveChannel = {
    id: string;
    company_id: string;
    from_identifier: string;
};

async function resolveChannel(
    admin: SupabaseClient,
    phoneNumberId: string
): Promise<ActiveChannel | null> {
    if (!phoneNumberId) return null;
    const { data } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier")
        .eq("status", "active")
        .eq("from_identifier", phoneNumberId)
        .maybeSingle();
    return data;
}

async function insertMirrorMessage(params: {
    admin: SupabaseClient;
    threadId: string;
    msg: ParsedCoexistenceMessage;
    direction: "inbound" | "outbound";
    senderType: "human";
    phoneNumberId: string;
    customerE164: string;
}): Promise<boolean> {
    const { error } = await params.admin.from("whatsapp_messages").insert({
        thread_id: params.threadId,
        direction: params.direction,
        channel: "whatsapp",
        provider: "meta",
        provider_message_id: params.msg.waId,
        from_addr: params.direction === "outbound" ? params.phoneNumberId : params.customerE164,
        to_addr: params.direction === "outbound" ? params.customerE164 : params.phoneNumberId,
        body: params.msg.body || null,
        num_media: 0,
        status: params.direction === "outbound" ? "sent" : "received",
        sender_type: params.senderType,
        raw_payload: params.msg.raw,
    });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    console.error("[wa/coexistence] insert error:", error.message);
    return false;
}

async function pauseBotOnThread(admin: SupabaseClient, threadId: string): Promise<void> {
    await admin
        .from("whatsapp_threads")
        .update({
            bot_active: false,
            handover_at: new Date().toISOString(),
        })
        .eq("id", threadId);
}

function metadataPhone(value: Record<string, unknown>): {
    phoneNumberId: string;
    displayPhone: string | null;
} {
    const meta = (value.metadata ?? {}) as Record<string, unknown>;
    return {
        phoneNumberId: String(meta.phone_number_id ?? "").trim(),
        displayPhone:
            typeof meta.display_phone_number === "string"
                ? meta.display_phone_number
                : null,
    };
}

export async function ingestCoexistenceWebhookField(params: {
    admin: SupabaseClient;
    field: string;
    value: unknown;
}): Promise<void> {
    const { admin, field, value } = params;
    const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

    if (field === "account_update") {
        const ev = parseAccountUpdateEvent(value);
        if (ev.event === "PARTNER_ADDED") {
            console.info("[wa/coexistence] PARTNER_ADDED", { hasWaba: Boolean(ev.wabaId) });
        }
        return;
    }

    const { phoneNumberId, displayPhone } = metadataPhone(rec);
    const channel = await resolveChannel(admin, phoneNumberId);
    if (!channel) return;

    if (field === "smb_message_echoes") {
        const echoes = parseMessageEchoes(value);
        for (const msg of echoes) {
            const customer = toE164Phone(msg.to || msg.from);
            if (!customer) continue;
            const threadId = await upsertWhatsappThread({
                admin,
                companyId: channel.company_id,
                channelId: channel.id,
                phoneE164: customer,
            });
            if (!threadId) continue;
            const inserted = await insertMirrorMessage({
                admin,
                threadId,
                msg,
                direction: "outbound",
                senderType: "human",
                phoneNumberId,
                customerE164: customer,
            });
            if (!inserted) continue;
            await pauseBotOnThread(admin, threadId);
            await admin
                .from("whatsapp_threads")
                .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: (msg.body || "[WhatsApp Business]").slice(0, 120),
                })
                .eq("id", threadId);
        }
        return;
    }

    if (field === "history") {
        const messages = parseHistoryMessages(value);
        const unreadByThread = new Map<string, number>();
        for (const msg of messages) {
            const fromBiz = isBusinessSender(msg.from, displayPhone);
            const customerRaw = fromBiz ? msg.to : msg.from;
            const customer = toE164Phone(customerRaw);
            if (!customer) continue;
            const threadId = await upsertWhatsappThread({
                admin,
                companyId: channel.company_id,
                channelId: channel.id,
                phoneE164: customer,
            });
            if (!threadId) continue;
            if (!unreadByThread.has(threadId)) {
                const { data } = await admin
                    .from("whatsapp_threads")
                    .select("unread_count")
                    .eq("id", threadId)
                    .maybeSingle();
                unreadByThread.set(
                    threadId,
                    typeof data?.unread_count === "number" ? data.unread_count : 0
                );
            }
            await insertMirrorMessage({
                admin,
                threadId,
                msg,
                direction: fromBiz ? "outbound" : "inbound",
                senderType: "human",
                phoneNumberId,
                customerE164: customer,
            });
        }
        await Promise.allSettled(
            [...unreadByThread.entries()].map(([threadId, unread]) =>
                admin.from("whatsapp_threads").update({ unread_count: unread }).eq("id", threadId)
            )
        );
        return;
    }

    if (field === "smb_app_state_sync") {
        // Contatos: sem tabela dedicada neste épico — só confirma digestão.
        console.info("[wa/coexistence] smb_app_state_sync received", {
            companyId: channel.company_id,
        });
    }
}
