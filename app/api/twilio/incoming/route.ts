import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeJson(obj: any) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

function normWa(addr: string | null) {
    // Twilio manda "whatsapp:+5565..."
    const s = String(addr ?? "").trim();
    if (!s) return null;
    return s.startsWith("whatsapp:") ? s : `whatsapp:${s}`;
}

function extractE164FromTwilio(from: string | null) {
    // "whatsapp:+5565999999999" => "+5565999999999"
    const s = String(from ?? "").trim();
    if (!s) return null;
    const v = s.startsWith("whatsapp:") ? s.slice("whatsapp:".length) : s;
    if (!v.startsWith("+")) return null;
    return v;
}

async function resolveTwilioChannel(admin: ReturnType<typeof createAdminClient>, toAddr: string | null) {
    // Ideal: whatsapp_channels.from_identifier guardar "whatsapp:+..." ou "+..."
    const toNorm = normWa(toAddr);
    const toE164 = toNorm?.startsWith("whatsapp:") ? toNorm.slice("whatsapp:".length) : null;

    if (toNorm) {
        const { data } = await admin
            .from("whatsapp_channels")
            .select("id, company_id, provider, status, from_identifier, provider_metadata")
            .eq("provider", "twilio")
            .eq("status", "active")
            .or(
                [
                    toNorm ? `from_identifier.eq.${toNorm}` : null,
                    toE164 ? `from_identifier.eq.${toE164}` : null,
                ]
                    .filter(Boolean)
                    .join(",")
            )
            .maybeSingle();

        if (data) return data;
    }

    // fallback: primeiro canal twilio ativo (se você tiver só 1, resolve)
    const { data: fallback } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, status, from_identifier, provider_metadata")
        .eq("provider", "twilio")
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
        const updatePayload: any = {
            channel_id: channelId,
            last_message_at: new Date().toISOString(),
        };
        // só atualiza nome se veio preenchido
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

    // Twilio manda x-www-form-urlencoded
    const fd = await req.formData().catch(() => null);
    const payload = fd
        ? Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)]))
        : {};

    const From = (payload["From"] ?? null) as string | null; // whatsapp:+...
    const To = (payload["To"] ?? null) as string | null; // whatsapp:+...
    const Body = (payload["Body"] ?? null) as string | null;

    const MessageSid = (payload["MessageSid"] ?? payload["SmsSid"] ?? null) as string | null;
    const MessageStatus = (payload["MessageStatus"] ?? payload["SmsStatus"] ?? null) as string | null;

    // 1) status callback (às vezes vem sem Body)
    // Atualiza status do outbound já gravado em whatsapp_messages
    if ((!Body || !Body.trim()) && MessageSid && MessageStatus) {
        await admin
            .from("whatsapp_messages")
            .update({
                status: MessageStatus,
                raw_payload: safeJson(payload),
            })
            .eq("provider", "twilio")
            .eq("provider_message_id", MessageSid);

        // Twilio aceita qualquer 200; responder TwiML vazio evita reentrega
        return new NextResponse(`<Response></Response>`, {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    // 2) inbound message normal
    const phoneE164 = extractE164FromTwilio(From);
    if (!phoneE164) {
        // responde 200 pra evitar reentrega infinita
        return new NextResponse(`<Response></Response>`, {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    const channel = await resolveTwilioChannel(admin, To);
    if (!channel) {
        // Sem canal -> responde 200 pra evitar reentrega infinita
        return new NextResponse(`<Response></Response>`, {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    // Twilio não manda nome fácil no inbound padrão; se você tiver ProfileName em alguma integração, dá pra mapear
    const profileName = null;

    const threadId = await getOrCreateThread({
        admin,
        companyId: channel.company_id,
        channelId: channel.id,
        phoneE164,
        profileName,
    });

    const bodyText = (Body ?? "").toString();

    // Insert inbound (dedup via índice unique provider+provider_message_id se você tiver)
    const { error: insErr } = await admin.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "in",
        channel: "whatsapp",
        provider: "twilio",
        provider_message_id: MessageSid,
        from_addr: normWa(From) ?? phoneE164,
        to_addr: normWa(To) ?? String(channel.from_identifier ?? "twilio"),
        body: bodyText,
        num_media: Number(payload["NumMedia"] ?? 0) || 0,
        status: "received",
        raw_payload: safeJson(payload),
    });

    // Se inseriu ok (não duplicou), atualiza preview/last_message_at
    if (!insErr) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: (bodyText ?? "").slice(0, 120) || null,
            })
            .eq("id", threadId);
    }

    // Resposta TwiML vazia (sem responder o usuário)
    return new NextResponse(`<Response></Response>`, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
    });
}
