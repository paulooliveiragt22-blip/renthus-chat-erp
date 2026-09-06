import type { SupabaseClient } from "@supabase/supabase-js";

export async function upsertWhatsappThread(params: {
    admin: SupabaseClient;
    companyId: string;
    channelId: string;
    phoneE164: string;
    profileName?: string | null;
}): Promise<string | null> {
    const { admin, companyId, channelId, phoneE164, profileName } = params;
    const channel = "whatsapp";
    const externalId = phoneE164;

    let existing: { id: string; profile_name: string | null } | null = null;

    const byIdentity = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", externalId)
        .maybeSingle();
    if (byIdentity.data?.id) {
        existing = byIdentity.data as { id: string; profile_name: string | null };
    } else {
        const byPhone = await admin
            .from("whatsapp_threads")
            .select("id, profile_name")
            .eq("company_id", companyId)
            .eq("phone_e164", phoneE164)
            .maybeSingle();
        if (byPhone.data?.id) {
            existing = byPhone.data as { id: string; profile_name: string | null };
        }
    }

    if (existing?.id) {
        const update: Record<string, unknown> = {
            channel_id: channelId,
            channel,
            external_id: externalId,
            phone_e164: phoneE164,
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
            company_id: companyId,
            channel_id: channelId,
            channel,
            external_id: externalId,
            phone_e164: phoneE164,
            profile_name: profileName ?? null,
            last_message_at: new Date().toISOString(),
            last_message_preview: null,
        })
        .select("id")
        .single();

    if (error || !created?.id) {
        console.error("[wa/thread] upsert error:", error?.message);
        return null;
    }
    return created.id;
}

export function toE164Phone(raw: string): string {
    const t = raw.trim();
    if (!t) return "";
    return t.startsWith("+") ? t : `+${t.replaceAll(/\D/g, "")}`;
}

export function phoneDigits(raw: string): string {
    return raw.replaceAll(/\D/g, "");
}
