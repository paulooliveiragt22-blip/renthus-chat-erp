/**
 * Webhook Meta Page / Instagram Messaging (object: page | instagram).
 *
 * GET  → verificação (hub.challenge) — token META_MESSAGING_WEBHOOK_VERIFY_TOKEN
 *        (fallback: WHATSAPP_WEBHOOK_VERIFY_TOKEN)
 * POST → assinatura X-Hub-Signature-256 (META_APP_SECRET ou WHATSAPP_APP_SECRET),
 *        persiste thread/mensagem, enfileira e wake do worker.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { scheduleQueueWorkerWake as scheduleQueueWorkerWakeShared } from "@/lib/chatbot/queueWorkerWake";
import { hasFeature } from "@/lib/billing/entitlements";
import {
    channelEnabledFor,
    loadActiveMetaChannelByIgUserId,
    loadActiveMetaChannelByPageId,
    type MetaMessagingChannelRow,
} from "@/lib/meta/messagingChannels";
import type { MessagingChannel } from "@/src/domain/contracts/identity";

export const runtime = "nodejs";

const CHATBOT_QUEUE_ENABLED = process.env.CHATBOT_QUEUE_ENABLED === "1";
const CHATBOT_QUEUE_WAKE_ENABLED = process.env.CHATBOT_QUEUE_WAKE_ENABLED !== "0";

const BOT_DISCLOSURE_PT_BR =
    "Olá! Sou o *assistente virtual* desta loja. Posso ajudar com cardápio e pedidos. " +
    "Se quiser falar com uma pessoa, digite *atendente*.";

function verifyToken(): string {
    return (
        process.env.META_MESSAGING_WEBHOOK_VERIFY_TOKEN?.trim() ||
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
        ""
    );
}

function appSecret(): string {
    return (
        process.env.META_APP_SECRET?.trim() ||
        process.env.WHATSAPP_APP_SECRET?.trim() ||
        ""
    );
}

function isValidMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
    const secret = appSecret();
    if (!secret) return false;
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const receivedHex = signatureHeader.slice("sha256=".length).trim();
    if (!receivedHex) return false;
    const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const receivedBuf = Buffer.from(receivedHex, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (receivedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(receivedBuf, expectedBuf);
}

function scheduleQueueWorkerWake(): void {
    if (!CHATBOT_QUEUE_WAKE_ENABLED) return;
    after(() => {
        scheduleQueueWorkerWakeShared({ reason: "meta_inbound_enqueue" });
    });
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

type MessagingEvent = {
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        quick_reply?: { payload?: string };
    };
    postback?: { payload?: string; title?: string };
};

export async function POST(req: NextRequest) {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    if (!isValidMetaSignature(rawBody, signature)) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let body: {
        object?: string;
        entry?: Array<{
            id?: string;
            messaging?: MessagingEvent[];
            standby?: MessagingEvent[];
        }>;
    };
    try {
        body = JSON.parse(rawBody) as typeof body;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const objectType = body.object;
    if (objectType !== "page" && objectType !== "instagram") {
        return NextResponse.json({ ok: true, ignored: true });
    }

    const admin = createAdminClient();
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
        const entryId = String(entry.id ?? "").trim();
        if (!entryId) continue;

        const channel: Extract<MessagingChannel, "instagram" | "messenger"> =
            objectType === "instagram" ? "instagram" : "messenger";

        let metaChannel: MetaMessagingChannelRow | null = null;
        if (channel === "instagram") {
            metaChannel =
                (await loadActiveMetaChannelByIgUserId(admin, entryId)) ||
                (await loadActiveMetaChannelByPageId(admin, entryId));
        } else {
            metaChannel = await loadActiveMetaChannelByPageId(admin, entryId);
        }
        if (!metaChannel || !channelEnabledFor(metaChannel, channel)) continue;

        const allowed = await hasFeature(
            admin,
            metaChannel.company_id,
            "omnichannel_ig_messenger"
        );
        if (!allowed) {
            console.warn("[meta/incoming] plan feature missing:", metaChannel.company_id);
            continue;
        }

        const events = [
            ...(Array.isArray(entry.messaging) ? entry.messaging : []),
            ...(Array.isArray(entry.standby) ? entry.standby : []),
        ];

        for (const ev of events) {
            await handleMessagingEvent({
                admin,
                metaChannel,
                channel,
                ev,
            });
        }
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

    const profileName =
        channel === "instagram" ? "Cliente Instagram" : "Cliente Messenger";

    const threadId = await upsertMetaThread({
        admin,
        companyId: metaChannel.company_id,
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
        bodyText,
        raw: ev,
    });
    if (!inserted) return;

    await maybeSendBotDisclosure({
        admin,
        companyId: metaChannel.company_id,
        threadId,
        channel,
        senderId,
        pageId: metaChannel.page_id,
        encryptedToken: metaChannel.encrypted_page_access_token,
        providerMetadata: metaChannel.provider_metadata,
    });

    if (CHATBOT_QUEUE_ENABLED) {
        const { error } = await admin.from("chatbot_queue").insert({
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
        });
        if (error && (error as { code?: string }).code !== "23505") {
            console.error("[meta/incoming] queue insert:", error.message);
            return;
        }
        if (!error) scheduleQueueWorkerWake();
        return;
    }

    try {
        await processInboundMessage({
            admin,
            companyId: metaChannel.company_id,
            threadId,
            messageId: providerMessageId,
            phoneE164: "",
            channelUserId: senderId,
            messagingChannel: channel,
            text: bodyText,
            profileName,
        });
    } catch (err) {
        console.error("[meta/incoming] processInboundMessage:", err);
    }
}

async function upsertMetaThread(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    channel: "instagram" | "messenger";
    externalId: string;
    profileName: string;
}): Promise<string | null> {
    const { admin, companyId, channel, externalId, profileName } = params;

    const { data: existing } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", externalId)
        .maybeSingle();

    if (existing?.id) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_inbound_at: new Date().toISOString(),
                ...(profileName && profileName !== existing.profile_name
                    ? { profile_name: profileName }
                    : {}),
            })
            .eq("id", existing.id);
        return existing.id as string;
    }

    const { data: created, error } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
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

async function maybeSendBotDisclosure(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    threadId: string;
    channel: "instagram" | "messenger";
    senderId: string;
    pageId: string;
    encryptedToken: string | null;
    providerMetadata: unknown;
}): Promise<void> {
    const { count } = await params.admin
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", params.threadId)
        .eq("direction", "outbound");

    if ((count ?? 0) > 0) return;

    const { MetaMessageGateway } = await import(
        "@/src/pro/adapters/meta/message.gateway.meta"
    );
    const gw = new MetaMessageGateway(params.admin, params.channel);
    await gw.send(
        {
            companyId: params.companyId,
            threadId: params.threadId,
            messageId: "disclosure",
            phoneE164: "",
            messagingChannel: params.channel,
            channelUserId: params.senderId,
        },
        { kind: "text", text: BOT_DISCLOSURE_PT_BR }
    );
}
