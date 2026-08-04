import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBrPhone } from "./phone";

export type WebMenuCustomer = {
    id: string;
    name: string | null;
    phoneE164: string;
    isNew: boolean;
};

/**
 * Localiza ou cria cliente da empresa por telefone (mesma ideia do Flow catalog).
 */
export async function resolveWebMenuCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneRaw: string,
    name?: string | null
): Promise<WebMenuCustomer | null> {
    const phone = normalizeBrPhone(phoneRaw);
    if (!phone.ok) return null;

    const { data: existing } = await admin
        .from("customers")
        .select("id, name, phone, phone_e164")
        .eq("company_id", companyId)
        .or(
            `phone_e164.eq.${phone.phoneE164},phone.eq.${phone.digits},phone.eq.${phone.phoneE164}`
        )
        .limit(1)
        .maybeSingle();

    if (existing?.id) {
        const patch: Record<string, unknown> = {};
        if (!existing.phone_e164) patch.phone_e164 = phone.phoneE164;
        const trimmedName = (name ?? "").trim();
        if (trimmedName && !existing.name) patch.name = trimmedName.slice(0, 120);
        if (Object.keys(patch).length > 0) {
            await admin.from("customers").update(patch).eq("id", existing.id);
        }
        return {
            id: existing.id as string,
            name: (trimmedName || existing.name || null) as string | null,
            phoneE164: phone.phoneE164,
            isNew: false,
        };
    }

    const displayName = (name ?? "").trim().slice(0, 120) || "Cliente";
    const { data: created, error } = await admin
        .from("customers")
        .insert({
            company_id: companyId,
            phone: phone.digits,
            phone_e164: phone.phoneE164,
            name: displayName,
            origem: "web_menu",
        })
        .select("id, name")
        .single();

    if (error || !created?.id) {
        console.error("[public-menu] create customer:", error?.message);
        return null;
    }

    return {
        id: created.id as string,
        name: (created.name as string | null) ?? displayName,
        phoneE164: phone.phoneE164,
        isNew: true,
    };
}
