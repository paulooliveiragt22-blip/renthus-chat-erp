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
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

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
            return String(m.text?.body ?? "").trim() || null;

        case "interactive": {
            const interactive = m.interactive ?? {};
            const subType = String(interactive.type ?? "");

            if (subType === "button_reply") {
                // Botão de resposta rápida de template interativo
                return String(interactive.button_reply?.title ?? interactive.button_reply?.id ?? "").trim() || null;
            }
            if (subType === "list_reply") {
                // Seleção de lista interativa
                return String(interactive.list_reply?.title ?? interactive.list_reply?.id ?? "").trim() || null;
            }
            // Outros sub-tipos: serializa para debug
            return JSON.stringify(interactive);
        }

        case "button":
            // Template quick-reply legado
            return String(m.button?.text ?? "").trim() || null;

        default:
            return null;
    }
}

// ─── Resolução de canal ───────────────────────────────────────────────────────

async function resolveChannel(
    admin: ReturnType<typeof createAdminClient>,
    phoneNumberId: string | null
) {
    if (phoneNumberId) {
        // Busca canal pelo phone_number_id salvo em provider_metadata
        const { data } = await admin
            .from("whatsapp_channels")
            .select("id, company_id, from_identifier, provider_metadata")
            .eq("provider", "meta")
            .eq("status", "active")
            .contains("provider_metadata", { phone_number_id: phoneNumberId })
            .maybeSingle();

        if (data) return data;

        // Fallback: qualquer canal meta ativo (single-tenant ou primeiro match)
        const { data: fallback } = await admin
            .from("whatsapp_channels")
            .select("id, company_id, from_identifier, provider_metadata")
            .eq("provider", "meta")
            .eq("status", "active")
            .limit(1)
            .maybeSingle();

        if (fallback) return fallback;
    }

    // Sem phone_number_id → pega primeiro canal ativo de qualquer provider meta
    const { data: any } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier, provider_metadata")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

    return any ?? null;
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

    if (createErr || !created?.id) throw new Error(createErr?.message ?? "Failed to create thread");
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

    // Resolve o canal da empresa pelo phone_number_id
    const channel = await resolveChannel(admin, phoneNumberId);

    if (!channel) {
        console.warn("[webhook] Nenhum canal ativo encontrado para phone_number_id:", phoneNumberId);
        return NextResponse.json({ ok: true, note: "no_active_channel" });
    }

    // ── 1. Mensagens inbound ──────────────────────────────────────────────────
    const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];

    for (const m of messages) {
        const messageId  = m?.id ? String(m.id) : null;
        const fromWaId   = m?.from ? String(m.from) : null;
        const phoneE164  = fromWaId ? normalizeE164(fromWaId) : null;

        if (!phoneE164) {
            console.warn("[webhook] from inválido, ignorando mensagem:", m);
            continue;
        }

        const profileName: string | null = value?.contacts?.[0]?.profile?.name ?? null;
        const bodyText = extractBodyText(m);

        // ── TESTE: eco automático para validar o fluxo de resposta ──────────
        if (bodyText) {
            sendWhatsAppMessage(phoneE164, `Recebi sua mensagem: ${bodyText}`)
                .then((r) => console.log("[webhook] eco enviado:", r))
                .catch((err) => console.error("[webhook] erro ao enviar eco:", err));
        }
        // ────────────────────────────────────────────────────────────────────

        let threadId: string;
        try {
            threadId = await getOrCreateThread({
                admin,
                companyId:   channel.company_id,
                channelId:   channel.id,
                phoneE164,
                profileName,
            });
        } catch (err) {
            console.error("[webhook] getOrCreateThread error:", err);
            continue;
        }

        // Insere mensagem; índice único (provider, provider_message_id) evita duplicação
        const { error: insErr } = await admin.from("whatsapp_messages").insert({
            thread_id:           threadId,
            direction:           "in",
            channel:             "whatsapp",
            provider:            "meta",
            provider_message_id: messageId,
            from_addr:           phoneE164,
            to_addr:             String(channel.from_identifier ?? phoneNumberId ?? ""),
            body:                bodyText,
            num_media:           0,
            status:              "received",
            raw_payload:         safeJson(payload),
        });

        if (insErr) {
            // Erro de violação de unicidade = mensagem duplicada → ignora silenciosamente
            if (insErr.code !== "23505") {
                console.error("[webhook] insert whatsapp_messages error:", insErr.message);
            }
            continue;
        }

        // Atualiza preview da thread
        await admin.from("whatsapp_threads").update({
            last_message_at:      new Date().toISOString(),
            last_message_preview: (bodyText ?? "").slice(0, 120) || null,
        }).eq("id", threadId);

        // Aciona o chatbot apenas se bot_active != false e houver texto
        if (bodyText) {
            const { data: threadRow } = await admin
                .from("whatsapp_threads")
                .select("bot_active")
                .eq("id", threadId)
                .maybeSingle();

            if (threadRow?.bot_active !== false) {
                processInboundMessage({
                    admin,
                    companyId:   channel.company_id,
                    threadId,
                    messageId:   messageId ?? "",
                    phoneE164,
                    text:        bodyText,
                    profileName,
                }).catch((err) => console.error("[chatbot] processInboundMessage error:", err));
            }
        }
    }

    // ── 2. Status updates (sent/delivered/read/failed) ────────────────────────
    const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];

    for (const s of statuses) {
        const id     = s?.id     ? String(s.id)     : null;
        const status = s?.status ? String(s.status) : null;
        if (!id || !status) continue;

        await admin
            .from("whatsapp_messages")
            .update({
                status,
                raw_payload: safeJson(payload),
            })
            .eq("provider", "meta")
            .eq("provider_message_id", id);
    }

    return NextResponse.json({ ok: true });
}
