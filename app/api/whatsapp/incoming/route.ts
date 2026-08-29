/**
 * app/api/whatsapp/incoming/route.ts
 *
 * Webhook da Meta WhatsApp Cloud API.
 *
 * GET  → verificação do webhook (hub.challenge)
 * POST → valida assinatura, persiste inbound e responde **200** ao Meta.
 *        Sempre enfileira em `chatbot_queue` e agenda wake
 *        (`after()` → SQS dispatch → Lambda worker, ADR-0003).
 *
 * Deduplicação: INSERT em whatsapp_messages com unique index em provider_message_id.
 * Se o Meta reenviar o mesmo waId (retry), o INSERT falha com 23505 e é ignorado.
 *
 * Pipeline assíncrono PRO: inbound enfileirado e processado pelo worker
 * (wake imediato + cron/scheduler backup).
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkRateLimitAsync } from "@/lib/security/rateLimitDistributed";
import { requesterIp } from "@/lib/security/rateLimit";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";
import { maybeSendBacklogNotice } from "@/lib/chatbot/backlogNotice";
import { tryTranscribeInboundAudio } from "@/lib/chatbot/transcribeInboundAudio";
import { handleWhatsappConsentKeyword } from "@/lib/channels/messageConsent";
import { scheduleInboundAfterEnqueue } from "@/lib/queue/afterEnqueue";
import { canProcessInboundChannel } from "@/lib/billing/canProcessInboundChannel";

export const runtime = "nodejs";
const INBOUND_ENQUEUE_DEDUP_WINDOW_SECONDS = getPositiveIntEnv("INBOUND_DEDUP_WINDOW_SECONDS", 20);

const INCOMING_RATE_LIMIT = 180;
const INCOMING_RATE_WINDOW_MS = 60_000;

function isValidMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) return false;
    if (!signatureHeader?.startsWith("sha256=")) return false;

    const receivedHex = signatureHeader.slice("sha256=".length).trim();
    if (!receivedHex) return false;

    const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const receivedBuf = Buffer.from(receivedHex, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (receivedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(receivedBuf, expectedBuf);
}

function maskIdentifier(value: string): string {
    if (!value) return "(empty)";
    if (value.length <= 6) return `${value.slice(0, 1)}***`;
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

type ActiveChannel = {
    id: string;
    company_id: string;
    from_identifier: string;
    provider_metadata: unknown;
    encrypted_access_token: string | null;
    waba_id: string | null;
};

function normalizeInboundText(text: string): string {
    return text
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replaceAll(/\s+/g, " ")
        .trim();
}

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

/**
 * `after()` do Next só funciona dentro do request scope de um handler chamado pelo runtime
 * (AsyncLocalStorage). Fora dele — testes de integração que invocam `POST`/`GET` diretamente,
 * ou qualquer chamada fora do ciclo normal de request — lança `E468` de forma síncrona. Melhor
 * esforço nesses casos: roda a task já (sem atrasar a resposta ao Meta, que já foi enviada).
 */
function safeAfter(task: () => void): void {
    try {
        after(task);
    } catch {
        task();
    }
}

async function emitInboundDedupMetric(companyId: string, threadId: string, reason: string) {
    const payload = {
        source: "wa_incoming_dedup",
        ts: Date.now(),
        companyId,
        threadId,
        reason,
    };

    const ingestUrl = process.env.METRICS_INGEST_URL;
    if (ingestUrl) {
        try {
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (process.env.METRICS_INGEST_TOKEN) {
                headers.authorization = `Bearer ${process.env.METRICS_INGEST_TOKEN}`;
            }
            await fetch(ingestUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            return;
        } catch {
            // fallback para log abaixo
        }
    }
    console.info("[metric] wa_incoming_dedup", payload);
}

// ─── GET — verificação do webhook ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode      = searchParams.get("hub.mode");
    const token     = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (!expectedToken) {
        console.error("[wa/incoming] WHATSAPP_WEBHOOK_VERIFY_TOKEN não definida");
        return new NextResponse("Server misconfigured", { status: 500 });
    }

    if (mode === "subscribe" && token === expectedToken) {
        return new NextResponse(challenge, { status: 200 });
    }

    console.warn("[wa/incoming] GET 403 | mode:", mode, "| token match:", token === expectedToken);
    return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST — mensagens inbound ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const admin = createAdminClient();
    const preflightError = await validateIncomingPreflight(req);
    if (preflightError) return preflightError;

    const parsedBody = await parseIncomingBody(req);
    if (parsedBody.errorResponse) return parsedBody.errorResponse;
    if (parsedBody.payload?.object !== "whatsapp_business_account") {
        return NextResponse.json({ ok: true });
    }

    await processIncomingEntries(admin, parsedBody.payload);
    return NextResponse.json({ ok: true }, { status: 200 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function validateIncomingPreflight(req: NextRequest): Promise<NextResponse | null> {
    const rl = await checkRateLimitAsync(
        `wa_incoming:${requesterIp(req)}`,
        INCOMING_RATE_LIMIT,
        INCOMING_RATE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    if (!process.env.WHATSAPP_APP_SECRET) {
        console.error("[wa/incoming] WHATSAPP_APP_SECRET não definida no ambiente.");
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }
    return null;
}

async function parseIncomingBody(req: NextRequest): Promise<{ payload?: any; errorResponse?: NextResponse }> {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-hub-signature-256");
    if (!isValidMetaSignature(rawBody, signatureHeader)) {
        return { errorResponse: NextResponse.json({ error: "invalid_signature" }, { status: 401 }) };
    }

    try {
        return { payload: JSON.parse(rawBody) };
    } catch {
        return { errorResponse: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
    }
}

async function processIncomingEntries(admin: ReturnType<typeof createAdminClient>, payload: any): Promise<void> {
    for (const entry of payload?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "messages") continue;
            await processIncomingChange(admin, change?.value ?? {});
        }
    }
}

async function processIncomingChange(admin: ReturnType<typeof createAdminClient>, value: any): Promise<void> {
    await processStatusUpdates(admin, value);

    const messages = value?.messages ?? [];
    if (!messages.length) return;

    const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
    const channel = await resolveActiveChannel(admin, phoneNumberId);
    if (!channel) return;

    const inboundGate = await canProcessInboundChannel(admin, channel.company_id);
    if (!inboundGate.allowed) {
        console.warn(
            `[wa/incoming] tenant access deny — drop inbound company=${channel.company_id} reason=${inboundGate.reason} phone=${maskIdentifier(phoneNumberId)}`
        );
        return;
    }

    const waConfig = buildWaConfig(channel, phoneNumberId);

    for (const msg of messages) {
        await processSingleInboundMessage({
            admin,
            value,
            msg,
            channel,
            waConfig,
            phoneNumberId,
        });
    }
}

async function processStatusUpdates(admin: ReturnType<typeof createAdminClient>, value: any): Promise<void> {
    for (const statusUpdate of value?.statuses ?? []) {
        const waId = statusUpdate?.id;
        const status = statusUpdate?.status;
        if (!waId || !status) continue;
        await admin
            .from("whatsapp_messages")
            .update({ status })
            .eq("provider", "meta")
            .eq("provider_message_id", waId);
    }
}

async function resolveActiveChannel(
    admin: ReturnType<typeof createAdminClient>,
    phoneNumberId: string
): Promise<ActiveChannel | null> {
    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("status", "active")
        .eq("from_identifier", phoneNumberId)
        .maybeSingle();

    if (!channel) {
        console.warn(`[wa/incoming] canal não encontrado para phone_number_id=${maskIdentifier(phoneNumberId)}`);
        return null;
    }
    return channel;
}

function buildWaConfig(channel: ActiveChannel, phoneNumberId: string): WaConfig {
    return {
        phoneNumberId: phoneNumberId || channel.from_identifier,
        accessToken: resolveChannelAccessToken(channel),
    };
}

function extractMessageText(msg: any, msgType: string): string {
    if (msgType === "text") return msg?.text?.body ?? "";
    if (msgType === "interactive") {
        const interactive = msg?.interactive ?? {};
        if (interactive.type === "button_reply") {
            return interactive.button_reply?.id ?? interactive.button_reply?.title ?? "";
        }
        if (interactive.type === "list_reply") {
            return interactive.list_reply?.id ?? interactive.list_reply?.title ?? "";
        }
    }
    if (msgType === "button") return msg?.button?.payload ?? msg?.button?.text ?? "";
    return "";
}

async function processSingleInboundMessage(params: {
    admin: ReturnType<typeof createAdminClient>;
    value: any;
    msg: any;
    channel: ActiveChannel;
    waConfig: WaConfig;
    phoneNumberId: string;
}): Promise<void> {
    const { admin, value, msg, channel, waConfig, phoneNumberId } = params;
    const waId = msg?.id as string | null;
    const fromRaw = msg?.from as string;
    const msgType = msg?.type as string;
    if (!fromRaw || !waId) return;

    const phoneE164 = fromRaw.startsWith("+") ? fromRaw : `+${fromRaw}`;
    const contact = (value?.contacts ?? []).find((c: any) => c.wa_id === fromRaw);
    const profileName: string | null = contact?.profile?.name ?? null;
    let bodyText = extractMessageText(msg, msgType);

    // Áudio / nota de voz → STT (Whisper) quando configurado
    if (!bodyText.trim() && (msgType === "audio" || msgType === "voice")) {
        const transcribed = await tryTranscribeInboundAudio({
            msg,
            msgType,
            waConfig,
            companyId: channel.company_id,
            admin,
        });
        if (transcribed) bodyText = transcribed;
    }

    const threadId = await upsertThread({
        admin,
        companyId: channel.company_id,
        channelId: channel.id,
        phoneE164,
        profileName,
    });
    if (!threadId) return;

    const inserted = await insertInboundMessage({
        admin,
        threadId,
        waId,
        phoneE164,
        phoneNumberId,
        bodyText,
        msgType,
        msg,
    });
    if (!inserted) return;

    await admin
        .from("whatsapp_threads")
        .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: bodyText.slice(0, 120) || (msgType === "audio" || msgType === "voice" ? "[áudio]" : null),
        })
        .eq("id", threadId);

    if (!bodyText.trim()) return;

    const consentHandled = await handleWhatsappConsentKeyword({
        admin,
        companyId: channel.company_id,
        phoneE164,
        bodyText,
        waConfig,
    });
    if (consentHandled) return;

    const shouldContinue = await ensureBotActiveOrRecover({
        admin,
        threadId,
        companyId: channel.company_id,
        phoneE164,
        waConfig,
    });
    if (!shouldContinue) return;

    await enqueueInboundIfNeeded({
        admin,
        channel,
        threadId,
        phoneE164,
        waId,
        bodyText,
        profileName,
        phoneNumberId,
        msgType,
        waConfig,
    });
}

async function insertInboundMessage(params: {
    admin: ReturnType<typeof createAdminClient>;
    threadId: string;
    waId: string;
    phoneE164: string;
    phoneNumberId: string;
    bodyText: string;
    msgType: string;
    msg: any;
}): Promise<boolean> {
    const { admin, threadId, waId, phoneE164, phoneNumberId, bodyText, msgType, msg } = params;
    const { error: insErr } = await admin
        .from("whatsapp_messages")
        .insert({
            thread_id: threadId,
            direction: "inbound",
            channel: "whatsapp",
            provider: "meta",
            provider_message_id: waId,
            from_addr: phoneE164,
            to_addr: phoneNumberId,
            body: bodyText || null,
            num_media: ["image", "video", "audio", "document"].includes(msgType) ? 1 : 0,
            status: "received",
            raw_payload: msg,
        });

    if (!insErr) return true;
    if ((insErr as any).code === "23505") {
        console.warn("[wa/incoming] dedup: mensagem já inserida, ignorando:", waId);
        return false;
    }
    console.error("[wa/incoming] insert error:", insErr.message);
    return false;
}

async function ensureBotActiveOrRecover(params: {
    admin: ReturnType<typeof createAdminClient>;
    threadId: string;
    companyId: string;
    phoneE164: string;
    waConfig: WaConfig;
}): Promise<boolean> {
    const { admin, threadId, companyId, phoneE164, waConfig } = params;
    const { data: threadRow } = await admin
        .from("whatsapp_threads")
        .select("bot_active, handover_at")
        .eq("id", threadId)
        .maybeSingle();

    if (threadRow?.bot_active !== false) return true;

    const HANDOVER_TIMEOUT_MS = 5 * 60 * 1000;
    const handoverAt = threadRow.handover_at ? new Date(threadRow.handover_at).getTime() : null;
    const timedOut = handoverAt !== null && (Date.now() - handoverAt) > HANDOVER_TIMEOUT_MS;
    if (!timedOut) return false;

    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: true, handover_at: null })
            .eq("id", threadId),
        admin
            .from("chatbot_sessions")
            .update({ step: "main_menu" })
            .eq("thread_id", threadId)
            .eq("company_id", companyId),
    ]);
    await sendWhatsAppMessage(
        phoneE164,
        `⏱️ Nenhum atendente respondeu nos últimos 5 minutos.\n\nVou continuar te ajudando por aqui! 😊`,
        waConfig
    );
    return true;
}

async function enqueueInboundIfNeeded(params: {
    admin: ReturnType<typeof createAdminClient>;
    channel: ActiveChannel;
    threadId: string;
    phoneE164: string;
    waId: string;
    bodyText: string;
    profileName: string | null;
    phoneNumberId: string;
    msgType: string;
    waConfig: WaConfig;
}): Promise<void> {
    const {
        admin,
        channel,
        threadId,
        phoneE164,
        waId,
        bodyText,
        profileName,
        phoneNumberId,
        msgType,
        waConfig,
    } = params;

    const dedupCutoff = new Date(Date.now() - INBOUND_ENQUEUE_DEDUP_WINDOW_SECONDS * 1000).toISOString();
    const normalizedBody = normalizeInboundText(bodyText);
    let shouldSkipEnqueue = false;

    if (msgType === "text" && normalizedBody) {
        const { data: recentJobs } = await admin
            .from("chatbot_queue")
            .select("body_text")
            .eq("thread_id", threadId)
            .eq("phone_e164", phoneE164)
            .in("status", ["pending", "processing", "done"])
            .gte("created_at", dedupCutoff)
            .limit(10);

        shouldSkipEnqueue = (recentJobs ?? []).some((j) => {
            const prev = typeof j.body_text === "string" ? normalizeInboundText(j.body_text) : "";
            return prev.length > 0 && prev === normalizedBody;
        });
    }

    if (shouldSkipEnqueue) {
        await emitInboundDedupMetric(channel.company_id, threadId, "enqueue_text_duplicate");
        return;
    }

    const { data: queueRow, error: queueErr } = await admin
        .from("chatbot_queue")
        .insert({
            company_id: channel.company_id,
            thread_id: threadId,
            phone_e164: phoneE164,
            message_id: waId,
            body_text: bodyText,
            profile_name: profileName ?? null,
            metadata: {
                source: "wa_incoming",
                phone_number_id: phoneNumberId,
                message_type: msgType,
            },
            status: "pending",
            attempts: 0,
            scheduled_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

    if (queueErr && (queueErr as { code?: string }).code !== "23505") {
        console.error("[wa/incoming] queue insert error:", queueErr.message);
        return;
    }

    if (!queueErr && queueRow?.id) {
        scheduleInboundAfterEnqueue(
            admin,
            {
                id: String(queueRow.id),
                company_id: channel.company_id,
                thread_id: threadId,
            },
            "inbound_enqueue"
        );
        // Aviso de fila sem atrasar o 200 ao Meta
        safeAfter(() => {
            void maybeSendBacklogNotice({
                admin,
                companyId: channel.company_id,
                threadId,
                phoneE164,
                waConfig,
            });
        });
    }
}

async function upsertThread(params: {
    admin:       ReturnType<typeof createAdminClient>;
    companyId:   string;
    channelId:   string;
    phoneE164:   string;
    profileName: string | null;
}): Promise<string | null> {
    const { admin, companyId, channelId, phoneE164, profileName } = params;
    const channel = "whatsapp";
    const externalId = phoneE164;

    // Preferência: identidade de canal; fallback: phone_e164 legado.
    let existing: { id: string; profile_name: string | null } | null = null;

    const byIdentity = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", externalId)
        .maybeSingle();
    if (byIdentity.data?.id) {
        existing = byIdentity.data as { id: string; profile_name: string | null };
    } else {
        const byPhone = await admin
            .from("whatsapp_threads")
            .select("id, profile_name")
            .eq("company_id", companyId)
            .eq("phone_e164", phoneE164)
            .maybeSingle();
        if (byPhone.data?.id) {
            existing = byPhone.data as { id: string; profile_name: string | null };
        }
    }

    if (existing?.id) {
        const update: Record<string, unknown> = {
            channel_id:      channelId,
            channel,
            external_id:     externalId,
            phone_e164:      phoneE164,
            last_message_at: new Date().toISOString(),
        };
        if (profileName && profileName !== existing.profile_name) {
            update.profile_name = profileName;
        }
        await admin.from("whatsapp_threads").update(update).eq("id", existing.id);
        return existing.id;
    }

    const { data: created, error } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id:           companyId,
            channel_id:           channelId,
            channel,
            external_id:          externalId,
            phone_e164:           phoneE164,
            profile_name:         profileName ?? null,
            last_message_at:      new Date().toISOString(),
            last_message_preview: null,
        })
        .select("id")
        .single();

    if (error || !created?.id) {
        console.error("[wa/incoming] upsertThread error:", error?.message);
        return null;
    }
    return created.id;
}
