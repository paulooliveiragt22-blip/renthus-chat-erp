import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function stripWhatsAppPrefix(v: string) {
    const s = String(v ?? "").trim();
    return s.startsWith("whatsapp:") ? s.replace("whatsapp:", "") : s;
}

function normalizeE164(v: string) {
    const p = stripWhatsAppPrefix(v).trim();
    if (!p) return null;
    if (!p.startsWith("+")) return null;
    return p;
}

function safeJson(obj: any) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

async function resolveTwilioChannel(admin: ReturnType<typeof createAdminClient>, toAddr: string) {
    // To vem tipo "whatsapp:+55..."
    // Vamos tentar bater com whatsapp_channels.from_identifier
    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, from_identifier")
        .eq("provider", "twilio")
        .eq("status", "active")
        .eq("from_identifier", toAddr)
        .maybeSingle();

    if (channel) return channel;

    // fallback: primeiro canal twilio ativo
    const { data: fallback } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, from_identifier")
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
    fromPhoneE164: string;
    waFrom: string;
    waTo: string;
    profileName?: string | null;
}) {
    const { admin, companyId, channelId, fromPhoneE164, waFrom, waTo, profileName } = params;

    const { data: existing, error: exErr } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("phone_e164", fromPhoneE164)
        .maybeSingle();

    if (exErr) throw new Error(exErr.message);

    if (existing?.id) {
        // ✅ não sobrescreve nome com null se não veio
        const updatePayload: any = {
            channel_id: channelId,
            wa_from: waFrom,
            wa_to: waTo,
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
            phone_e164: fromPhoneE164,
            wa_from: waFrom,
            wa_to: waTo,
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
    const form = await req.formData();

    const From = String(form.get("From") ?? "");
    const To = String(form.get("To") ?? "");
    const Body = String(form.get("Body") ?? "");
    const MessageSid = String(form.get("MessageSid") ?? "");
    const AccountSid = String(form.get("AccountSid") ?? "");
    const ProfileName = String(form.get("ProfileName") ?? "");
    const NumMedia = Number(form.get("NumMedia") ?? 0);

    // callbacks de status às vezes vêm assim
    const MessageStatus = String(form.get("MessageStatus") ?? form.get("SmsStatus") ?? "");

    const admin = createAdminClient();

    // ✅ se for status callback (sem Body) apenas atualiza whatsapp_messages
    if ((!Body || !Body.trim()) && MessageSid && MessageStatus) {
        await admin
            .from("whatsapp_messages")
            .update({
                status: MessageStatus,
                raw_payload: safeJson(Object.fromEntries(form.entries())),
            })
            .eq("provider", "twilio")
            .eq("provider_message_id", MessageSid);

        // TwiML vazio
        return new NextResponse(`<Response></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // Identifica company pelo canal Twilio (To)
    const channel = await resolveTwilioChannel(admin, To);
    if (!channel) {
        // Sem canal configurado -> responde 200 pra evitar reentrega infinita
        return new NextResponse(`<Response></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const fromPhoneE164 = normalizeE164(From);
    if (!fromPhoneE164) {
        return new NextResponse(`<Response></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const threadId = await getOrCreateThread({
        admin,
        companyId: channel.company_id,
        channelId: channel.id,
        fromPhoneE164,
        waFrom: From,
        waTo: To,
        profileName: ProfileName || null,
    });

    const bodyText = (Body ?? "").trim();

    // Salva mensagem inbound
    const { error: insErr } = await admin.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "in",
        channel: "whatsapp",
        provider: "twilio",
        provider_message_id: MessageSid || null,
        twilio_message_sid: MessageSid || null,
        twilio_account_sid: AccountSid || null,
        from_addr: From,
        to_addr: To,
        body: bodyText || null,
        num_media: Number.isFinite(NumMedia) ? NumMedia : 0,
        status: "received",
        raw_payload: safeJson(Object.fromEntries(form.entries())),
    });

    // ✅ atualiza preview/last_message_at na thread (só se inseriu sem duplicar)
    if (!insErr) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: (bodyText ?? "").slice(0, 120) || null,
            })
            .eq("id", threadId);
    }

    // ✅ NÃO responder mensagem automática (TwiML vazio)
    return new NextResponse(`<Response></Response>`, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
    });
}
