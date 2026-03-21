/**
 * app/api/whatsapp/webhook/route.ts
 *
 * Webhook para a Meta WhatsApp Cloud API.
 *
 * GET  — verificação do webhook (hub.mode / hub.verify_token / hub.challenge)
 * POST — recebimento de mensagens e status updates
 *
 * Tipos de mensagem tratados:
 *   text       → m.text.body
 *   interactive → button_reply (m.interactive.button_reply.title)
 *                 list_reply   (m.interactive.list_reply.title)
 *   button     → m.button.text  (template quick-reply legado)
 *
 * Variáveis de ambiente necessárias:
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN — token de verificação cadastrado no Meta
 *   WHATSAPP_PHONE_NUMBER_ID      — phone_number_id do número cadastrado
 */

import { NextResponse, NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(obj: unknown): unknown {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

/**
 * Normaliza wa_id da Cloud API para E.164.
 * A Meta envia o número sem '+', ex: "5565999999999"
 */
function normalizeE164(waId: string): string | null {
    const p = String(waId ?? "").trim();
    if (!p) return null;
    return p.startsWith("+") ? p : `+${p}`;
}

/**
 * Extrai o texto relevante de um objeto de mensagem da Cloud API.
 * Retorna null para tipos não suportados (imagem, áudio, etc.).
 */
function extractBodyText(m: any): string | null {
    const type = String(m?.type ?? "");

    switch (type) {
        case "text":
            return (String(m.text?.body ?? "").trim()) || null;

        case "interactive": {
            const interactive = m.interactive ?? {};
            const subType = String(interactive.type ?? "");

            if (subType === "button_reply") {
                // Preferir id sobre title para que o bot reconheça os IDs (change_items, change_address, etc.)
                return (String(interactive.button_reply?.id ?? interactive.button_reply?.title ?? "").trim()) || null;
            }
            if (subType === "list_reply") {
                // Seleção de lista interativa — retorna o id para permitir lookup por variantId/_case
                return (String(interactive.list_reply?.id ?? interactive.list_reply?.title ?? "").trim()) || null;
            }
            // Outros sub-tipos: serializa para debug
            return JSON.stringify(interactive);
        }

        case "button":
            // Template quick-reply legado
            return (String(m.button?.text ?? "").trim()) || null;

        default:
            return null;
    }
}

// ─── Resolução de canal ───────────────────────────────────────────────────────

async function resolveChannel(
    admin: ReturnType<typeof createAdminClient>,
    phoneNumberId: string | null
) {
    if (!phoneNumberId) {
        console.warn("[webhook] resolveChannel: payload sem phone_number_id");
        return null;
    }

    // Busca estrita pelo phone_number_id dentro de provider_metadata (JSONB ->> text)
    // Equivale a: WHERE provider_metadata->>'phone_number_id' = $1
    const { data, error } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier, provider_metadata")
        .eq("provider", "meta")
        .eq("status", "active")
        .filter("provider_metadata->>phone_number_id", "eq", phoneNumberId)
        .maybeSingle();

    if (error) {
        console.warn("[webhook] resolveChannel JSONB filter error:", error.message);
        return null;
    }

    if (!data) {
        console.warn("[webhook] resolveChannel: nenhum canal meta ativo com phone_number_id:", phoneNumberId);
        return null;
    }

    return data;
}

// ─── Thread ───────────────────────────────────────────────────────────────────

async function getOrCreateThread(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    channelId: string;
    phoneE164: string;
    profileName?: string | null;
}): Promise<string> {
    const { admin, companyId, channelId, phoneE164, profileName } = params;

    const { data: existing, error: fetchErr } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);

    if (existing?.id) {
        const patch: Record<string, unknown> = {
            channel_id: channelId,
            last_message_at: new Date().toISOString(),
        };
        if (profileName) patch.profile_name = profileName;

        await admin.from("whatsapp_threads").update(patch).eq("id", existing.id);
        return existing.id;
    }

    const { data: created, error: createErr } = await admin
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

    if (createErr || !created?.id) throw new Error((createErr?.message ?? "Failed to create thread"));
    return created.id;
}

// ─── GET — verificação do webhook ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    const mode      = searchParams.get("hub.mode");
    const token     = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";

    if (mode === "subscribe" && token === verifyToken) {
        console.log("[webhook] GET verificação OK");
        return new Response(challenge, { status: 200 });
    }

    console.warn("[webhook] GET verificação FALHOU", { mode, token });
    return new Response("Forbidden", { status: 403 });
}

// ─── POST — recebimento de eventos ────────────────────────────────────────────

export async function POST(req: Request) {
    const payload = await req.json().catch(() => ({} as any));

    // DEBUG: loga o body completo para facilitar diagnóstico
    console.log("[webhook] POST payload:", JSON.stringify(payload, null, 2));

    const admin = createAdminClient();

    // Estrutura padrão da Cloud API:
    // { object: "whatsapp_business_account", entry: [{ changes: [{ value: {...} }] }] }
    const entry  = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    if (!value) {
        // Payload vazio ou formato inesperado — responde 200 para evitar reentrega
        return NextResponse.json({ ok: true, note: "no_value" });
    }

    const phoneNumberId: string | null = value?.metadata?.phone_number_id ?? null;
    console.log("[webhook] phone_number_id:", phoneNumberId);

    // Resolve o canal da empresa pelo phone_number_id
    const channel = await resolveChannel(admin, phoneNumberId);
    console.log("[webhook] channel resolvido:", channel ? `id=${channel.id} company=${channel.company_id}` : "NENHUM");

    if (!channel) {
        console.warn("[webhook] Nenhum canal ativo encontrado para phone_number_id:", phoneNumberId);
        return NextResponse.json({ ok: true, note: "no_active_channel" });
    }

    // ── 1. Mensagens inbound ──────────────────────────────────────────────────
    const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];
    const profileName: string | null = value?.contacts?.[0]?.profile?.name ?? null;
    let enqueuedCount = 0;

    for (const m of messages) {
        const messageId = m?.id ? String(m.id) : null;
        const fromWaId  = m?.from ? String(m.from) : null;
        const phoneE164 = fromWaId ? normalizeE164(fromWaId) : null;

        if (!phoneE164) continue;

        const bodyText = extractBodyText(m);
        const msgType: string = String(m?.type ?? "text");

        // Detecta mídia
        let numMedia = 0;
        let mediaSummary: any = null;
        if (msgType === "image" && m.image) {
            numMedia = 1; mediaSummary = { type: "image", id: m.image.id, mime_type: m.image.mime_type, caption: m.image.caption ?? null };
        } else if (msgType === "video" && m.video) {
            numMedia = 1; mediaSummary = { type: "video", id: m.video.id, mime_type: m.video.mime_type, caption: m.video.caption ?? null };
        } else if (msgType === "audio" && m.audio) {
            numMedia = 1; mediaSummary = { type: "audio", id: m.audio.id, mime_type: m.audio.mime_type };
        } else if (msgType === "document" && m.document) {
            numMedia = 1; mediaSummary = { type: "document", id: m.document.id, mime_type: m.document.mime_type, filename: m.document.filename ?? null };
        }

        let threadId: string;
        try {
            threadId = await getOrCreateThread({ admin, companyId: channel.company_id, channelId: channel.id, phoneE164, profileName });
        } catch (err) {
            console.error("[webhook] getOrCreateThread error:", err);
            continue;
        }

        // Insere mensagem (índice único evita duplicação) + preview da thread em paralelo
        const [{ error: insErr }] = await Promise.all([
            admin.from("whatsapp_messages").insert({
                thread_id:           threadId,
                direction:           "inbound",
                channel:             "whatsapp",
                provider:            "meta",
                provider_message_id: messageId,
                from_addr:           phoneE164,
                to_addr:             String(channel.from_identifier ?? phoneNumberId ?? ""),
                body:                bodyText,
                num_media:           numMedia,
                status:              "received",
                raw_payload:         safeJson({ ...payload, _media: mediaSummary }),
            }),
            admin.from("whatsapp_threads").update({
                last_message_at:      new Date().toISOString(),
                last_message_preview: ((bodyText ?? "").slice(0, 120)) || null,
            }).eq("id", threadId),
        ]);

        if (insErr && insErr.code !== "23505") {
            console.error("[webhook] insert whatsapp_messages error:", insErr.code, insErr.message);
            continue;
        }

        if (!bodyText) continue; // mídia sem texto — não enfileira para chatbot

        // Enfileira para processamento assíncrono (deduplicação por message_id)
        const { error: queueErr } = await admin
            .from("chatbot_queue")
            .upsert({
                company_id:   channel.company_id,
                thread_id:    threadId,
                phone_e164:   phoneE164,
                message_id:   messageId,
                body_text:    bodyText,
                profile_name: profileName ?? null,
                metadata:     { channel_id: channel.id },
            }, { onConflict: "message_id", ignoreDuplicates: true });

        if (queueErr) {
            console.error("[webhook] falha ao enfileirar:", queueErr.message);
        } else {
            enqueuedCount++;
        }
    }

    // ── 2. Status updates (fire-and-forget, sem bloquear) ────────────────────
    const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];
    if (statuses.length > 0) {
        Promise.all(
            statuses
                .filter((s) => s?.id && s?.status)
                .map((s) =>
                    admin
                        .from("whatsapp_messages")
                        .update({ status: String(s.status), raw_payload: safeJson(payload) })
                        .eq("provider", "meta")
                        .eq("provider_message_id", String(s.id))
                )
        ).catch((err) => console.error("[webhook] status update error:", err));
    }

    // ── 3. Retorna 200 imediatamente ao Meta ─────────────────────────────────
    // Triggering process-queue fire-and-forget (sem await — não bloqueia resposta)
    if (enqueuedCount > 0) {
        const base = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
        fetch(`${base}/api/chatbot/process-queue`, {
            headers: process.env.CRON_SECRET
                ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
                : {},
        }).catch(() => {}); // ignore — job persiste na fila se falhar
    }

    return NextResponse.json({ ok: true });
}
