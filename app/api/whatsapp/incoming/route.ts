/**
 * app/api/whatsapp/incoming/route.ts
 *
 * Webhook da Meta WhatsApp Cloud API.
 *
 * GET  → verificação do webhook (hub.challenge)
 * POST → mensagens e status callbacks
 *
 * Configurar no Meta Business:
 *   URL:   https://<seu-dominio>/api/whatsapp/incoming
 *   Token: process.env.WHATSAPP_VERIFY_TOKEN
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/chatbot/processMessage";

export const runtime = "nodejs";

// ─── GET — verificação do webhook ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode      = searchParams.get("hub.mode");
    const token     = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        return new NextResponse(challenge, { status: 200 });
    }
    return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST — mensagens inbound ──────────────────────────────────────────────────

export async function POST(req: Request) {
    const admin = createAdminClient();

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    // A Meta sempre envia object === "whatsapp_business_account"
    if (body?.object !== "whatsapp_business_account") {
        return NextResponse.json({ ok: true }); // ignorar outros webhooks
    }

    for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "messages") continue;

            const value = change?.value ?? {};

            // ── Status callbacks (sent, delivered, read, failed) ─────────────
            for (const statusUpdate of value?.statuses ?? []) {
                const waId   = statusUpdate?.id;
                const status = statusUpdate?.status;   // sent | delivered | read | failed
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

            // Resolve canal da empresa pelo phone_number_id
            const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
            const { data: channel } = await admin
                .from("whatsapp_channels")
                .select("id, company_id, from_identifier, provider_metadata")
                .eq("provider", "meta")
                .eq("status", "active")
                .maybeSingle();

            if (!channel) continue; // nenhum canal Meta configurado

            for (const msg of messages) {
                const waId      = msg?.id as string | null;
                const fromRaw   = msg?.from as string; // ex: "5565999999999" (sem +)
                const msgType   = msg?.type as string; // text | interactive | image | ...
                const timestamp = msg?.timestamp;

                if (!fromRaw || !waId) continue;

                // Normaliza para E.164
                const phoneE164 = fromRaw.startsWith("+") ? fromRaw : `+${fromRaw}`;

                // Nome do perfil do contato
                const contact    = (value?.contacts ?? []).find((c: any) => c.wa_id === fromRaw);
                const profileName: string | null = contact?.profile?.name ?? null;

                // Extrai texto da mensagem (text ou interactive reply)
                let bodyText = "";
                if (msgType === "text") {
                    bodyText = msg?.text?.body ?? "";
                } else if (msgType === "interactive") {
                    const interactive = msg?.interactive ?? {};
                    if (interactive.type === "button_reply") {
                        bodyText = interactive.button_reply?.title ?? interactive.button_reply?.id ?? "";
                    } else if (interactive.type === "list_reply") {
                        bodyText = interactive.list_reply?.title ?? interactive.list_reply?.id ?? "";
                    }
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

                // ── Insere mensagem (dedup via provider_message_id) ──────────
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
                        num_media:           msgType === "image" || msgType === "video" || msgType === "audio" || msgType === "document" ? 1 : 0,
                        status:              "received",
                        raw_payload:         msg,
                    });

                if (insErr) {
                    // Código 23505 = unique violation → mensagem duplicada, ignorar
                    if ((insErr as any).code === "23505") continue;
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

                // ── Dispara chatbot (se bot ativo e há texto) ────────────────
                if (!bodyText.trim()) continue;

                const { data: threadRow } = await admin
                    .from("whatsapp_threads")
                    .select("bot_active")
                    .eq("id", threadId)
                    .maybeSingle();

                if (threadRow?.bot_active === false) continue;

                processInboundMessage({
                    admin,
                    companyId:   channel.company_id,
                    threadId,
                    messageId:   waId,
                    phoneE164,
                    text:        bodyText,
                    profileName,
                }).catch((err) =>
                    console.error("[chatbot] processInboundMessage error:", err)
                );
            }
        }
    }

    // Meta exige 200 em até 5s; responde imediatamente
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
