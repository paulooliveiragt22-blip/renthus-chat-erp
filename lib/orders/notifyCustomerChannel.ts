import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import {
    channelEnabledFor,
    loadActiveMetaChannelByCompany,
    resolvePageAccessToken,
} from "@/lib/meta/messagingChannels";
import { sendMetaPageText } from "@/lib/meta/sendMetaMessage";
import { sendWhatsAppMessage } from "@/lib/whatsapp/sendMessage";
import { resolveFreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";

type MetaChannel = Extract<MessagingChannel, "instagram" | "messenger">;

export type NotifyCustomerChannelParams = {
    admin: SupabaseClient;
    companyId: string;
    customerId: string;
    phoneE164: string;
    text: string;
    /** Origem da sessão (cardápio IG/Messenger). */
    originChannel?: MessagingChannel;
    originExternalId?: string;
};

export type NotifyCustomerChannelResult = {
    ok: boolean;
    channel: "whatsapp" | MetaChannel | "none";
    error?: string;
};

async function sendMetaDm(params: {
    admin: SupabaseClient;
    companyId: string;
    channel: MetaChannel;
    externalId: string;
    text: string;
}): Promise<NotifyCustomerChannelResult> {
    const { admin, companyId, channel, externalId, text } = params;
    const recipientId = externalId.trim();
    if (!recipientId) {
        return { ok: false, channel: "none", error: "missing_external_id" };
    }

    const metaRow = await loadActiveMetaChannelByCompany(admin, companyId);
    if (!metaRow || !channelEnabledFor(metaRow, channel)) {
        return { ok: false, channel: "none", error: "meta_channel_unavailable" };
    }

    const accessToken = resolvePageAccessToken(metaRow);
    if (!accessToken) {
        return { ok: false, channel: "none", error: "missing_page_token" };
    }

    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("id, last_inbound_at")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", recipientId)
        .maybeSingle();

    const policy = resolveFreeFormSendPolicy({
        channel,
        lastInboundAt: (thread?.last_inbound_at as string | null) ?? null,
    });
    if (!policy.allowAutomated) {
        console.info("[notifyCustomerChannel] meta skip outside window", {
            companyId,
            channel,
            externalId: recipientId,
            reason: policy.reason,
        });
        return { ok: false, channel, error: policy.reason ?? "outside_service_window" };
    }

    const result = await sendMetaPageText({
        pageId: metaRow.page_id,
        accessToken,
        recipientId,
        text,
    });

    if (!result.ok) {
        console.warn("[notifyCustomerChannel] meta send failed:", result.error);
        return { ok: false, channel, error: result.error ?? "meta_send_failed" };
    }

    if (thread?.id) {
        await admin.from("whatsapp_messages").insert({
            thread_id: thread.id,
            direction: "outbound",
            sender_type: "bot",
            channel,
            provider: "meta",
            body: text,
            provider_message_id: result.messageId ?? null,
            to_addr: recipientId,
            status: "sent",
        });
        await admin
            .from("whatsapp_threads")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", thread.id);
    }

    return { ok: true, channel };
}

async function resolveMetaIdentity(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    originChannel?: MessagingChannel,
    originExternalId?: string
): Promise<{ channel: MetaChannel; externalId: string } | null> {
    if (
        (originChannel === "instagram" || originChannel === "messenger") &&
        originExternalId?.trim()
    ) {
        return { channel: originChannel, externalId: originExternalId.trim() };
    }

    const { data: rows } = await admin
        .from("customer_channel_identities")
        .select("channel, external_id")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .in("channel", ["instagram", "messenger"])
        .order("updated_at", { ascending: false })
        .limit(1);

    const row = rows?.[0];
    if (!row?.external_id) return null;
    const ch = String(row.channel);
    if (ch !== "instagram" && ch !== "messenger") return null;
    return { channel: ch, externalId: String(row.external_id) };
}

/**
 * Notifica cliente no canal de origem (IG/Messenger) quando disponível;
 * senão WhatsApp pelo telefone.
 */
export async function notifyCustomerChannel(
    params: NotifyCustomerChannelParams
): Promise<NotifyCustomerChannelResult> {
    const { admin, companyId, customerId, phoneE164, text } = params;
    const body = text.trim();
    if (!body) return { ok: false, channel: "none", error: "empty_text" };

    const metaIdentity = await resolveMetaIdentity(
        admin,
        companyId,
        customerId,
        params.originChannel,
        params.originExternalId
    );

    if (metaIdentity) {
        const meta = await sendMetaDm({
            admin,
            companyId,
            channel: metaIdentity.channel,
            externalId: metaIdentity.externalId,
            text: body,
        });
        if (meta.ok) return meta;
    }

    const phone = phoneE164.trim();
    if (!phone) {
        return { ok: false, channel: "none", error: "no_delivery_channel" };
    }

    try {
        const wa = await sendWhatsAppMessage({
            admin,
            companyId,
            toPhone: phone,
            text: body,
            senderType: "bot",
        });
        if (!wa.ok) {
            console.warn("[notifyCustomerChannel] whatsapp failed:", wa.error);
            return { ok: false, channel: "whatsapp", error: wa.error };
        }
        return { ok: true, channel: "whatsapp" };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[notifyCustomerChannel] whatsapp error:", msg);
        return { ok: false, channel: "whatsapp", error: msg };
    }
}
