import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Cloud API payload vem no formato:
 * entry[0].changes[0].value.messages[0] (mensagens)
 * entry[0].changes[0].value.statuses[0] (status)
 */

function safeJson(obj: any) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

function normalizeE164FromCloudApi(waIdOrPhone: string) {
    // Cloud API costuma mandar wa_id como número sem '+' (ex: "5565999999999")
    const p = String(waIdOrPhone ?? "").trim();
    if (!p) return null;
    return p.startsWith("+") ? p : `+${p}`;
}

async function resolve360dialogChannel(admin: ReturnType<typeof createAdminClient>, phoneNumberId: string | null) {
    if (phoneNumberId) {
        // Recomendado: salvar o phone_number_id em provider_metadata no whatsapp_channels
        // Ex: provider_metadata: { "phone_number_id": "123" }
        const { data } = await admin
            .from("whatsapp_channels")
            .select("id, company_id, provider, status, from_identifier, provider_metadata")
            .eq("provider", "360dialog")
            .eq("status", "active")
            .contains("provider_metadata", { phone_number_id: phoneNumberId })
            .maybeSingle();

        if (data) return data;
    }

    // fallback: primeiro canal 360dialog ativo
    const { data: fallback } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, status, from_identifier, provider_metadata")
        .eq("provider", "360dialog")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

    return fallback ?? null;
}

async function getOrCreateThread(params: {
    admin: ReturnType<typeof createAdminClient>;
    companyId: string;
    channelId: string;
    phoneE164: string;
    profileName?: string | null;
}) {
    const { admin, companyId, channelId, phoneE164, profileName } = params;

    const { data: existing, error: exErr } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();

    if (exErr) throw new Error(exErr.message);

    if (existing?.id) {
        // só atualiza profile_name se veio um nome (evita sobrescrever com null)
        const updatePayload: any = {
            channel_id: channelId,
            last_message_at: new Date().toISOString(),
        };
        if (profileName) updatePayload.profile_name = profileName;

        await admin.from("whatsapp_threads").update(updatePayload).eq("id", existing.id);

        return existing.id;
    }

    const { data: created, error } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
            channel_id: channelId,
            phone_e164: phoneE164,
            profile_name: profileName ?? null,
            last_message_at: new Date().toISOString(),
            last_message_preview: null,
        })
        .select("id")
        .single();

    if (error || !created?.id) throw new Error(error?.message || "Failed to create thread");
    return created.id;
}

export async function POST(req: Request) {
    const admin = createAdminClient();
    const payload = await req.json().catch(() => ({} as any));

    // 1) extrair nodes principais
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id ?? null;

    const channel = await resolve360dialogChannel(admin, phoneNumberId);
    if (!channel) {
        // Sem canal -> responde 200 pra evitar reentrega infinita
        return NextResponse.json({ ok: true, note: "No active 360dialog channel configured" });
    }

    // 2) Mensagens inbound
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    for (const m of messages) {
        const messageId = m?.id ? String(m.id) : null;
        const fromWaId = m?.from ? String(m.from) : null;
        const phoneE164 = fromWaId ? normalizeE164FromCloudApi(fromWaId) : null;

        if (!phoneE164) continue;

        const profileName = value?.contacts?.[0]?.profile?.name ?? null;

        const threadId = await getOrCreateThread({
            admin,
            companyId: channel.company_id,
            channelId: channel.id,
            phoneE164,
            profileName,
        });

        let bodyText: string | null = null;
        const type = String(m?.type ?? "");

        if (type === "text") bodyText = String(m?.text?.body ?? "");
        else if (type === "button") bodyText = String(m?.button?.text ?? "");
        else if (type === "interactive") bodyText = JSON.stringify(m?.interactive ?? {});
        else bodyText = null;

        // insert dedup: provider+provider_message_id unique index já evita duplicação
        const { error: insErr } = await admin.from("whatsapp_messages").insert({
            thread_id: threadId,
            direction: "in",
            channel: "whatsapp",
            provider: "360dialog",
            provider_message_id: messageId,
            from_addr: phoneE164,
            to_addr: String(channel.from_identifier ?? "360dialog"),
            body: bodyText,
            num_media: 0,
            status: "received",
            raw_payload: safeJson(payload),
        });

        // se já existia (duplicado), não precisa atualizar preview
        if (!insErr) {
            await admin
                .from("whatsapp_threads")
                .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: (bodyText ?? "").slice(0, 120) || null,
                })
                .eq("id", threadId);
        }
    }

    // 3) Status updates (delivered/read/failed)
    const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
    for (const s of statuses) {
        const id = s?.id ? String(s.id) : null;
        const status = s?.status ? String(s.status) : null;
        if (!id || !status) continue;

        await admin
            .from("whatsapp_messages")
            .update({
                status,
                raw_payload: safeJson(payload),
            })
            .eq("provider", "360dialog")
            .eq("provider_message_id", id);
    }

    return NextResponse.json({ ok: true });
}
