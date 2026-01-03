import { NextResponse } from "next/server";
import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function stripWhatsAppPrefix(v: string) {
    return v.startsWith("whatsapp:") ? v.replace("whatsapp:", "") : v;
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

    const { data: existing } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone_e164", fromPhoneE164)
        .maybeSingle();

    if (existing?.id) {
        await admin
            .from("whatsapp_threads")
            .update({
                channel_id: channelId,
                wa_from: waFrom,
                wa_to: waTo,
                profile_name: profileName ?? null,
                last_message_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

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

    const admin = createAdminClient();

    // Identifica company pelo canal Twilio (To)
    const channel = await resolveTwilioChannel(admin, To);
    if (!channel) {
        // sem canal configurado, responde ok mas loga
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("✅ Recebido. (Canal não configurado no ERP)");
        return new NextResponse(twiml.toString(), { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const fromPhoneE164 = stripWhatsAppPrefix(From);

    const threadId = await getOrCreateThread({
        admin,
        companyId: channel.company_id,
        channelId: channel.id,
        fromPhoneE164,
        waFrom: From,
        waTo: To,
        profileName: ProfileName || null,
    });

    // Salva mensagem inbound (provider != null => trigger conta usage)
    await admin.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "in",
        channel: "whatsapp",
        provider: "twilio",
        provider_message_id: MessageSid || null,
        twilio_message_sid: MessageSid || null,
        twilio_account_sid: AccountSid || null,
        from_addr: From,
        to_addr: To,
        body: Body || null,
        num_media: Number.isFinite(NumMedia) ? NumMedia : 0,
        status: "received",
        raw_payload: Object.fromEntries(form.entries()),
    });

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`✅ OK! Recebi: ${Body || "(vazio)"}`);

    return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { "Content-Type": "text/xml" },
    });
}
