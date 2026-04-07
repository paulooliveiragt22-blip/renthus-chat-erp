/**
 * app/api/whatsapp/incoming/route.ts
 *
 * Webhook da Meta WhatsApp Cloud API.
 *
 * GET  → verificação do webhook (hub.challenge)
 * POST → processa mensagens com await e retorna 200 após processamento.
 *        processInboundMessage é aguardado para garantir que o Lambda
 *        não seja congelado antes de concluir o fluxo do chatbot.
 *
 * Deduplicação: INSERT em whatsapp_messages com unique index em provider_message_id.
 * Se o Meta reenviar o mesmo waId (retry), o INSERT falha com 23505 e é ignorado.
 *
 * TODO (upgrade Pro): substituir processInboundMessage por enqueue em chatbot_queue
 * e ativar o cron "* * * * *" para processamento assíncrono com retry automático.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
    const admin = createAdminClient();

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-hub-signature-256");
    if (!isValidMetaSignature(rawBody, signatureHeader)) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let body: any;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (body?.object !== "whatsapp_business_account") {
        return NextResponse.json({ ok: true });
    }

    for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "messages") continue;

            const value = change?.value ?? {};

            // ── Status callbacks (sent, delivered, read, failed) ─────────────
            for (const statusUpdate of value?.statuses ?? []) {
                const waId   = statusUpdate?.id;
                const status = statusUpdate?.status;
                if (waId && status) {
                    await admin
                        .from("whatsapp_messages")
                        .update({ status })
                        .eq("provider", "meta")
                        .eq("provider_message_id", waId);
                }
            }

            // ── Mensagens inbound ────────────────────────────────────────────
            const messages = value?.messages ?? [];
            if (!messages.length) continue;

            const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";

            // Busca canal por from_identifier (sem filtro de provider — pode variar por setup)
            let { data: channel } = await admin
                .from("whatsapp_channels")
                .select("id, company_id, from_identifier, provider_metadata")
                .eq("status", "active")
                .eq("from_identifier", phoneNumberId)
                .maybeSingle();

            // Fallback: único canal ativo (setup single-tenant / dev)
            if (!channel) {
                const { data: fallback } = await admin
                    .from("whatsapp_channels")
                    .select("id, company_id, from_identifier, provider_metadata")
                    .eq("status", "active")
                    .limit(1)
                    .maybeSingle();

                if (fallback) {
                    console.warn(
                        `[wa/incoming] canal não encontrado por from_identifier=${phoneNumberId}, usando fallback id=${fallback.id}`
                    );
                    channel = fallback;
                }
            }

            if (!channel) {
                console.warn("[wa/incoming] canal não encontrado para phone_number_id:", phoneNumberId);
                continue;
            }

            const channelMeta = channel.provider_metadata as {
                access_token?:    string;
                catalog_flow_id?: string;
            } | null;
            const waConfig: WaConfig = {
                // Usa o phoneNumberId vindo da Meta (fonte da verdade),
                // não o from_identifier do DB (pode estar desatualizado)
                phoneNumberId: phoneNumberId || channel.from_identifier,
                accessToken:   channelMeta?.access_token ?? process.env.WHATSAPP_TOKEN ?? "",
            };
            const catalogFlowId = channelMeta?.catalog_flow_id ?? process.env.WHATSAPP_CATALOG_FLOW_ID;

            for (const msg of messages) {
                const waId    = msg?.id as string | null;
                const fromRaw = msg?.from as string;
                const msgType = msg?.type as string;

                if (!fromRaw || !waId) continue;

                const phoneE164 = fromRaw.startsWith("+") ? fromRaw : `+${fromRaw}`;

                const contact     = (value?.contacts ?? []).find((c: any) => c.wa_id === fromRaw);
                const profileName: string | null = contact?.profile?.name ?? null;

                // Extrai texto — botões e listas preferem ID para a lógica do bot
                let bodyText = "";
                if (msgType === "text") {
                    bodyText = msg?.text?.body ?? "";
                } else if (msgType === "interactive") {
                    const interactive = msg?.interactive ?? {};
                    if (interactive.type === "button_reply") {
                        // ID primeiro: "change_items", "1", "confirm_order_yes", etc.
                        bodyText = interactive.button_reply?.id ?? interactive.button_reply?.title ?? "";
                    } else if (interactive.type === "list_reply") {
                        bodyText = interactive.list_reply?.id ?? interactive.list_reply?.title ?? "";
                    }
                } else if (msgType === "button") {
                    bodyText = msg?.button?.text ?? "";
                }

                // ── Upsert thread ────────────────────────────────────────────
                const threadId = await upsertThread({
                    admin,
                    companyId:   channel.company_id,
                    channelId:   channel.id,
                    phoneE164,
                    profileName,
                });

                if (!threadId) continue;

                // ── Insere mensagem (dedup via provider_message_id único) ─────
                const { error: insErr } = await admin
                    .from("whatsapp_messages")
                    .insert({
                        thread_id:           threadId,
                        direction:           "inbound",
                        channel:             "whatsapp",
                        provider:            "meta",
                        provider_message_id: waId,
                        from_addr:           phoneE164,
                        to_addr:             phoneNumberId,
                        body:                bodyText || null,
                        num_media:           ["image","video","audio","document"].includes(msgType) ? 1 : 0,
                        status:              "received",
                        raw_payload:         msg,
                    });

                if (insErr) {
                    if ((insErr as any).code === "23505") {
                        // Duplicata (Meta reentregou) — ignora
                        console.warn("[wa/incoming] dedup: mensagem já inserida, ignorando:", waId);
                        continue;
                    }
                    console.error("[wa/incoming] insert error:", insErr.message);
                    continue;
                }

                // ── Atualiza preview da thread ───────────────────────────────
                await admin
                    .from("whatsapp_threads")
                    .update({
                        last_message_at:      new Date().toISOString(),
                        last_message_preview: (bodyText ?? "").slice(0, 120) || null,
                    })
                    .eq("id", threadId);

                if (!bodyText.trim()) continue;

                // ── Verifica bot_active (com timeout de handover de 5 min) ──
                const { data: threadRow } = await admin
                    .from("whatsapp_threads")
                    .select("bot_active, handover_at")
                    .eq("id", threadId)
                    .maybeSingle();

                if (threadRow?.bot_active === false) {
                    const HANDOVER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
                    const handoverAt = threadRow.handover_at
                        ? new Date(threadRow.handover_at).getTime()
                        : null;
                    const timedOut = handoverAt !== null
                        && (Date.now() - handoverAt) > HANDOVER_TIMEOUT_MS;

                    if (!timedOut) continue;

                    // Timeout expirado: restaura o bot preservando o carrinho
                    await Promise.all([
                        admin
                            .from("whatsapp_threads")
                            .update({ bot_active: true, handover_at: null })
                            .eq("id", threadId),
                        admin
                            .from("chatbot_sessions")
                            .update({ step: "main_menu" })
                            .eq("thread_id", threadId)
                            .eq("company_id", channel.company_id),
                    ]);

                    await sendWhatsAppMessage(
                        phoneE164,
                        `⏱️ Nenhum atendente respondeu nos últimos 5 minutos.\n\nVou continuar te ajudando por aqui! 😊`,
                        waConfig
                    );
                    // Continua para processInboundMessage normalmente
                }

                // ── Processa chatbot com await (Lambda deve concluir antes do retorno) ──
                try {
                    await processInboundMessage({
                        admin,
                        companyId:   channel.company_id,
                        threadId,
                        messageId:   waId,
                        phoneE164,
                        text:        bodyText,
                        profileName,
                        waConfig,
                        catalogFlowId,
                    });
                } catch (err: any) {
                    console.error("[chatbot] processInboundMessage error:", err?.message ?? err);
                }
            }
        }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertThread(params: {
    admin:       ReturnType<typeof createAdminClient>;
    companyId:   string;
    channelId:   string;
    phoneE164:   string;
    profileName: string | null;
}): Promise<string | null> {
    const { admin, companyId, channelId, phoneE164, profileName } = params;

    const { data: existing } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();

    if (existing?.id) {
        const update: Record<string, unknown> = {
            channel_id:      channelId,
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
