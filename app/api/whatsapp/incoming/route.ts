import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Twilio inbound webhook for WhatsApp.
//
// This route handles both inbound messages and status callbacks from Twilio.  It
// resolves the correct WhatsApp channel based on the `To` address, creates
// or updates a thread record, inserts the inbound message into
// `whatsapp_messages`, updates the thread preview, and returns an empty
// TwiML response so Twilio does not attempt to resend.

export const runtime = "nodejs";

/**
 * Remove the `whatsapp:` prefix from a Twilio address.
 */
function stripWhatsAppPrefix(v: string) {
    const s = String(v ?? "").trim();
    return s.startsWith("whatsapp:") ? s.replace("whatsapp:", "") : s;
}

/**
 * Normalize a Twilio phone string into E.164.  Returns null if not valid.
 */
function normalizeE164(v: string) {
    const p = stripWhatsAppPrefix(v).trim();
    if (!p) return null;
    if (!p.startsWith("+")) return null;
    return p;
}

/**
 * Safely clone JSON-serializable objects.  Used for storing raw payloads.
 */
function safeJson(obj: any) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

/**
 * Resolve the Twilio channel for the given `toAddr`.  The `toAddr` comes from
 * Twilio in the format `whatsapp:+5566...`.  The lookup is performed
 * against `whatsapp_channels.from_identifier`; if no exact match is found
 * the first active Twilio channel is returned as a fallback.
 */
async function resolveTwilioChannel(
    admin: ReturnType<typeof createAdminClient>,
    toAddr: string
) {
    // Try to match the exact from_identifier value
    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, from_identifier")
        .eq("provider", "twilio")
        .eq("status", "active")
        .eq("from_identifier", toAddr)
        .maybeSingle();

    if (channel) return channel;

    // Fallback: first active Twilio channel
    const { data: fallback } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, provider, from_identifier")
        .eq("provider", "twilio")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

    return fallback ?? null;
}

/**
 * Find or create a thread for the incoming message.
 *
 * A thread is uniquely identified by (company_id, phone_e164).  If an
 * existing thread is found it is updated with the latest channel and
 * timestamps.  If no thread exists, a new record is inserted.  The
 * `profileName` is only applied if provided.
 */
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
        // Update channel and last_message_at; only update profile_name if provided
        const updatePayload: any = {
            channel_id: channelId,
            wa_from: waFrom,
            wa_to: waTo,
            last_message_at: new Date().toISOString(),
        };
        if (profileName) updatePayload.profile_name = profileName;

        await admin
            .from("whatsapp_threads")
            .update(updatePayload)
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
            last_message_preview: null,
        })
        .select("id")
        .single();

    if (error || !created?.id) {
        throw new Error(error?.message || "Failed to create thread");
    }
    return created.id;
}

export async function POST(req: Request) {
    // Twilio sends x-www-form-urlencoded body
    const form = await req.formData();

    const From = String(form.get("From") ?? "");
    const To = String(form.get("To") ?? "");
    const Body = String(form.get("Body") ?? "");
    const MessageSid = String(form.get("MessageSid") ?? "");
    const AccountSid = String(form.get("AccountSid") ?? "");
    const ProfileName = String(form.get("ProfileName") ?? "");
    const NumMedia = Number(form.get("NumMedia") ?? 0);
    // Status callbacks may use MessageStatus or SmsStatus
    const MessageStatus = String(form.get("MessageStatus") ?? form.get("SmsStatus") ?? "");

    const admin = createAdminClient();

    // Status callback: only update message status and do not insert new record
    if ((!Body || !Body.trim()) && MessageSid && MessageStatus) {
        await admin
            .from("whatsapp_messages")
            .update({
                status: MessageStatus,
                raw_payload: safeJson(Object.fromEntries(form.entries())),
            })
            .eq("provider", "twilio")
            .eq("provider_message_id", MessageSid);

        return new NextResponse("<Response></Response>", {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    // Resolve the channel for this inbound message
    const channel = await resolveTwilioChannel(admin, To);
    if (!channel) {
        // If no channel configured, respond 200 to avoid re-delivery
        return new NextResponse("<Response></Response>", {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    // Normalize from address to E.164
    const fromPhoneE164 = normalizeE164(From);
    if (!fromPhoneE164) {
        // Cannot determine phone number; respond OK to avoid re-delivery
        return new NextResponse("<Response></Response>", {
            status: 200,
            headers: { "Content-Type": "text/xml" },
        });
    }

    // Find or create thread
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

    // Insert inbound message; deduplication is enforced via unique index on provider+provider_message_id
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

    // If inserted (no duplication), update the thread preview and timestamp
    if (!insErr) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: (bodyText ?? "").slice(0, 120) || null,
            })
            .eq("id", threadId);
    }

    // Return an empty TwiML response so Twilio does not retry
    return new NextResponse("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
    });
}