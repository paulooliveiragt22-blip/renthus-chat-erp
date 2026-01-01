import { NextResponse } from "next/server";
import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const form = await req.formData();

    const From = String(form.get("From") ?? "");
    const To = String(form.get("To") ?? "");
    const Body = String(form.get("Body") ?? "");
    const MessageSid = String(form.get("MessageSid") ?? "");
    const AccountSid = String(form.get("AccountSid") ?? "");
    const ProfileName = String(form.get("ProfileName") ?? "");
    const NumMedia = Number(form.get("NumMedia") ?? 0);

    // salvar no supabase (pode manter)
    const supabase = createAdminClient();
    const phoneE164 = From.replace("whatsapp:", "");

    await supabase
        .from("whatsapp_threads")
        .upsert(
            {
                phone_e164: phoneE164,
                wa_from: From,
                wa_to: To,
                profile_name: ProfileName || null,
                last_message_at: new Date().toISOString(),
            },
            { onConflict: "phone_e164" }
        );

    await supabase.from("whatsapp_messages").insert({
        thread_id: (await supabase.from("whatsapp_threads").select("id").eq("phone_e164", phoneE164).single()).data?.id,
        direction: "inbound",
        channel: "whatsapp",
        twilio_message_sid: MessageSid || null,
        twilio_account_sid: AccountSid || null,
        from_addr: From,
        to_addr: To,
        body: Body || null,
        num_media: Number.isFinite(NumMedia) ? NumMedia : 0,
        raw_payload: Object.fromEntries(form.entries()),
    });

    // ✅ Responder TwiML
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`✅ Conectado! Você disse: ${Body || "(vazio)"}`);

    return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
}
