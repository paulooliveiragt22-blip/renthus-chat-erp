import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    channelEnabledFor,
    loadActiveMetaChannelByCompany,
    resolvePageAccessToken,
} from "@/lib/meta/messagingChannels";
import { sendMetaPageText } from "@/lib/meta/sendMetaMessage";
import { resolveFreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";
import type { MessagingChannel } from "@/src/domain/contracts/identity";

export type HumanMetaSendResult =
    | { ok: true; providerMessageId?: string; usedHumanAgentTag: boolean }
    | { ok: false; error: string; status?: number };

/**
 * Envio humano (inbox) para Instagram/Messenger.
 * Dentro da 24h: RESPONSE. Fora: MESSAGE_TAG HUMAN_AGENT (B4).
 */
export async function sendHumanMetaThreadText(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    text: string;
}): Promise<HumanMetaSendResult> {
    const text = params.text.trim();
    if (!text) return { ok: false, error: "text_required", status: 400 };

    const { data: thread, error: thErr } = await params.admin
        .from("whatsapp_threads")
        .select("id, company_id, channel, external_id, phone_e164, last_inbound_at")
        .eq("id", params.threadId)
        .eq("company_id", params.companyId)
        .maybeSingle();

    if (thErr) return { ok: false, error: thErr.message, status: 500 };
    if (!thread) return { ok: false, error: "thread_not_found", status: 404 };

    const channel = String(thread.channel ?? "").trim() as MessagingChannel;
    if (channel !== "instagram" && channel !== "messenger") {
        return { ok: false, error: "not_meta_channel", status: 400 };
    }

    const recipientId = String(thread.external_id ?? "").trim();
    if (!recipientId) {
        return { ok: false, error: "missing_external_id", status: 400 };
    }

    const row = await loadActiveMetaChannelByCompany(params.admin, params.companyId);
    if (!row) return { ok: false, error: "meta_channel_not_configured", status: 400 };
    if (!channelEnabledFor(row, channel)) {
        return { ok: false, error: `${channel}_disabled`, status: 403 };
    }

    const accessToken = resolvePageAccessToken(row);
    if (!accessToken) return { ok: false, error: "missing_page_token", status: 400 };

    const policy = resolveFreeFormSendPolicy({
        channel,
        lastInboundAt: (thread.last_inbound_at as string | null) ?? null,
    });

    const useHumanAgentTag = !policy.allowAutomated && policy.allowHumanAgentTag;
    if (!policy.allowAutomated && !policy.allowHumanAgentTag) {
        return { ok: false, error: "outside_service_window", status: 403 };
    }

    const { data: created, error: insErr } = await params.admin
        .from("whatsapp_messages")
        .insert({
            thread_id: params.threadId,
            direction: "outbound",
            sender_type: "human",
            channel,
            provider: null,
            from_addr: row.page_id,
            to_addr: recipientId,
            body: text,
            num_media: 0,
            status: "pending",
        })
        .select("id")
        .single();

    if (insErr || !created?.id) {
        return { ok: false, error: insErr?.message ?? "failed_to_create_message", status: 500 };
    }

    const sendResult = await sendMetaPageText({
        pageId: row.page_id,
        accessToken,
        recipientId,
        text,
        messagingType: useHumanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
        tag: useHumanAgentTag ? "HUMAN_AGENT" : undefined,
    });

    if (!sendResult.ok) {
        await params.admin
            .from("whatsapp_messages")
            .update({
                status: "failed",
                error: sendResult.error ?? "send_failed",
                raw_payload: { error: sendResult.error, human_agent_tag: useHumanAgentTag },
            })
            .eq("id", created.id);
        return {
            ok: false,
            error: sendResult.error ?? "send_failed",
            status: sendResult.status && sendResult.status >= 400 ? 502 : 502,
        };
    }

    await params.admin
        .from("whatsapp_messages")
        .update({
            provider: "meta",
            provider_message_id: sendResult.messageId ?? null,
            status: "sent",
            raw_payload: {
                messaging_type: useHumanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
                tag: useHumanAgentTag ? "HUMAN_AGENT" : null,
                sent_at: new Date().toISOString(),
            },
        })
        .eq("id", created.id);

    await params.admin
        .from("whatsapp_threads")
        .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: text.slice(0, 120),
        })
        .eq("id", params.threadId);

    return {
        ok: true,
        providerMessageId: sendResult.messageId,
        usedHumanAgentTag: useHumanAgentTag,
    };
}
