/**
 * Webhook Meta Page / Instagram Messaging (object: page | instagram).
 *
 * GET  → verificação (hub.challenge) — token META_MESSAGING_WEBHOOK_VERIFY_TOKEN
 *        (fallback: WHATSAPP_WEBHOOK_VERIFY_TOKEN)
 * POST → assinatura X-Hub-Signature-256 (META_APP_SECRET ou WHATSAPP_APP_SECRET),
 *        persiste thread/mensagem, enfileira e wake do worker.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidMetaWebhookSignature } from "@/lib/meta/validateMetaWebhookSignature";
import {
    collectMetaAccountIds,
    extractMetaMessagingEvents,
    normalizeMetaMessagingWebhookBody,
    type MetaMessagingEvent,
} from "@/lib/meta/parseMetaMessagingWebhook";
import { scheduleInboundAfterEnqueue } from "@/lib/queue/afterEnqueue";
import { hasFeature } from "@/lib/billing/entitlements";
import {
    channelEnabledFor,
    loadActiveMetaChannelByIgUserId,
    loadActiveMetaChannelByPageId,
    resolvePageAccessToken,
    type MetaMessagingChannelRow,
} from "@/lib/meta/messagingChannels";
import {
    fallbackMetaThreadProfileName,
    shouldUpdateThreadProfileName,
} from "@/lib/meta/customerDisplayName";
import { fetchMetaChannelUserProfile } from "@/lib/meta/fetchMetaUserProfile";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/rateLimit";
import { canProcessInboundChannel } from "@/lib/billing/canProcessInboundChannel";

export const runtime = "nodejs";

const META_INCOMING_RATE_LIMIT = 180;

function verifyToken(): string {
    return (
        process.env.META_MESSAGING_WEBHOOK_VERIFY_TOKEN?.trim() ||
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
        ""
    );
}

export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get("hub.mode");
    const token = req.nextUrl.searchParams.get("hub.verify_token");
    const challenge = req.nextUrl.searchParams.get("hub.challenge");
    const expected = verifyToken();
    if (mode === "subscribe" && expected && token === expected && challenge) {
        return new NextResponse(challenge, { status: 200 });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

type MessagingEvent = MetaMessagingEvent;

async function resolveMetaChannel(
    admin: ReturnType<typeof createAdminClient>,
    channel: Extract<MessagingChannel, "instagram" | "messenger">,
    accountIds: string[]
): Promise<MetaMessagingChannelRow | null> {
    for (const id of accountIds) {
        if (!id) continue;
        if (channel === "instagram") {
            const byIg = await loadActiveMetaChannelByIgUserId(admin, id);
            if (byIg) return byIg;
            const byPage = await loadActiveMetaChannelByPageId(admin, id);
            if (byPage) return byPage;
        } else {
            const byPage = await loadActiveMetaChannelByPageId(admin, id);
            if (byPage) return byPage;
        }
    }
    return null;
}

export async function POST(req: NextRequest) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "meta_incoming",
        META_INCOMING_RATE_LIMIT,
        RATE_LIMIT_WINDOW_MS
    );
    if (limited) return limited;

    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    if (!isValidMetaWebhookSignature(rawBody, signature)) {
        console.warn("[meta/incoming] invalid_signature", {
            hasSignature: Boolean(signature),
            hasMetaSecret: Boolean(process.env.META_APP_SECRET?.trim()),
            hasWaSecret: Boolean(process.env.WHATSAPP_APP_SECRET?.trim()),
            hasIgProductSecret: Boolean(
                process.env.META_INSTAGRAM_APP_SECRET?.trim() ||
                    process.env.INSTAGRAM_APP_SECRET?.trim()
            ),
        });
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let body: ReturnType<typeof normalizeMetaMessagingWebhookBody>;
    try {
        body = normalizeMetaMessagingWebhookBody(JSON.parse(rawBody));
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!body) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const objectType = body.object;
    if (objectType !== "page" && objectType !== "instagram") {
        return NextResponse.json({ ok: true, ignored: true, object: objectType ?? null });
    }

    const admin = createAdminClient();
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let processedEvents = 0;

    for (const entry of entries) {
        const events = extractMetaMessagingEvents(entry);
        const accountIds = collectMetaAccountIds(entry, events);

        const channel: Extract<MessagingChannel, "instagram" | "messenger"> =
            objectType === "instagram" ? "instagram" : "messenger";

        const metaChannel = await resolveMetaChannel(admin, channel, accountIds);
        if (!metaChannel || !channelEnabledFor(metaChannel, channel)) {
            console.warn("[meta/incoming] channel_not_found", {
                object: objectType,
                accountIds,
                hasMessaging: Boolean(entry.messaging?.length),
                hasChanges: Boolean(entry.changes?.length),
            });
            continue;
        }

        const allowed = await hasFeature(
            admin,
            metaChannel.company_id,
            "omnichannel_ig_messenger"
        );
        if (!allowed) {
            console.warn("[meta/incoming] plan feature missing:", metaChannel.company_id);
            continue;
        }

        const inboundGate = await canProcessInboundChannel(admin, metaChannel.company_id);
        if (!inboundGate.allowed) {
            console.warn("[meta/incoming] tenant access deny:", {
                companyId: metaChannel.company_id,
                reason: inboundGate.reason,
            });
            continue;
        }

        for (const ev of events) {
            await handleMessagingEvent({
                admin,
                metaChannel,
                channel,
                ev,
            });
            processedEvents += 1;
        }
    }

    if (entries.length > 0 && processedEvents === 0) {
        console.warn("[meta/incoming] no_events_processed", {
            object: objectType,
            entryIds: entries.map((e) => e.id).filter(Boolean),
        });
    }

    return NextResponse.json({ ok: true });
}

async function handleMessagingEvent(params: {
    admin: ReturnType<typeof createAdminClient>;
    metaChannel: MetaMessagingChannelRow;
    channel: Extract<MessagingChannel, "instagram" | "messenger">;
    ev: MessagingEvent;
}): Promise<void> {
    const { admin, metaChannel, channel, ev } = params;
    if (ev.message?.is_echo) return;

    const senderId = String(ev.sender?.id ?? "").trim();
    if (!senderId) return;

    let bodyText = "";
    let providerMessageId = "";
    if (ev.message?.text) {
        bodyText = String(ev.message.text);
        providerMessageId = String(ev.message.mid ?? `txt_${Date.now()}`);
        if (ev.message.quick_reply?.payload) {
            bodyText = String(ev.message.quick_reply.payload);
        }
    } else if (ev.postback?.payload) {
        bodyText = String(ev.postback.payload);
        providerMessageId = `postback_${ev.timestamp ?? Date.now()}`;
    } else {
        return;
    }
    if (!bodyText.trim()) return;

    const toAddr =
        String(ev.recipient?.id ?? "").trim() ||
        (channel === "instagram"
            ? String(metaChannel.ig_user_id ?? "").trim()
            : String(metaChannel.page_id ?? "").trim()) ||
        String(metaChannel.page_id ?? "").trim();
    if (!toAddr) {
        console.warn("[meta/incoming] missing to_addr", {
            channel,
            pageId: metaChannel.page_id,
            igUserId: metaChannel.ig_user_id,
        });
        return;
    }

    let profileName = fallbackMetaThreadProfileName(channel);
    const pageToken = resolvePageAccessToken(metaChannel);
    if (pageToken) {
        const profile = await fetchMetaChannelUserProfile({
            channel,
            userId: senderId,
            pageId: metaChannel.page_id,
            accessToken: pageToken,
        });
        if (profile?.displayName) {
            profileName = profile.displayName;
        }
    }

    const threadId = await upsertMetaThread({
        admin,
        companyId: metaChannel.company_id,
        metaChannelId: metaChannel.id,
        channel,
        externalId: senderId,
        profileName,
    });
    if (!threadId) return;

    const inserted = await insertMetaInbound({
        admin,
        companyId: metaChannel.company_id,
        threadId,
        channel,
        providerMessageId,
        senderId,
        toAddr,
        bodyText,
        raw: ev,
    });
    if (!inserted) return;

    const { data: queueRow, error: queueErr } = await admin
        .from("chatbot_queue")
        .insert({
            company_id: metaChannel.company_id,
            thread_id: threadId,
            phone_e164: null,
            channel_user_id: senderId,
            messaging_channel: channel,
            message_id: providerMessageId,
            body_text: bodyText,
            profile_name: profileName,
            metadata: {
                source: "meta_messaging_incoming",
                page_id: metaChannel.page_id,
            },
            status: "pending",
            attempts: 0,
            scheduled_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
    if (queueErr && (queueErr as { code?: string }).code !== "23505") {
        console.error("[meta/incoming] queue insert:", queueErr.message);
        return;
    }
    if (!queueErr && queueRow?.id) {
        scheduleInboundAfterEnqueue(
            admin,
            {
                id: String(queueRow.id),
                company_id: metaChannel.company_id,
                thread_id: threadId,
            },
            "meta_inbound_enqueue"
        );
    }
}

async function upsertMetaThread(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    metaChannelId: string;
    channel: "instagram" | "messenger";
    externalId: string;
    profileName: string;
}): Promise<string | null> {
    const { admin, companyId, metaChannelId, channel, externalId, profileName } = params;

    const { data: existing } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", externalId)
        .maybeSingle();

    if (existing?.id) {
        const updates: Record<string, string> = {
            channel_id: metaChannelId,
            last_message_at: new Date().toISOString(),
            last_inbound_at: new Date().toISOString(),
        };
        if (shouldUpdateThreadProfileName(existing.profile_name, profileName)) {
            updates.profile_name = profileName;
        }
        await admin.from("whatsapp_threads").update(updates).eq("id", existing.id);
        return existing.id as string;
    }

    const { data: created, error } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
            channel_id: metaChannelId,
            channel,
            external_id: externalId,
            phone_e164: null,
            profile_name: profileName,
            last_message_at: new Date().toISOString(),
            last_inbound_at: new Date().toISOString(),
            bot_active: true,
        })
        .select("id")
        .single();

    if (error || !created?.id) {
        console.error("[meta/incoming] upsertThread:", error?.message);
        return null;
    }
    return created.id as string;
}

async function insertMetaInbound(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    threadId: string;
    channel: string;
    providerMessageId: string;
    senderId: string;
    toAddr: string;
    bodyText: string;
    raw: unknown;
}): Promise<boolean> {
    const { error } = await params.admin.from("whatsapp_messages").insert({
        thread_id: params.threadId,
        direction: "inbound",
        channel: params.channel,
        provider: "meta",
        provider_message_id: params.providerMessageId,
        from_addr: params.senderId,
        to_addr: params.toAddr,
        body: params.bodyText,
        status: "received",
        raw_payload: params.raw,
        sender_type: "customer",
    });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    console.error("[meta/incoming] insert message:", error.message);
    return false;
}
