import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBrPhone } from "./phone";
import {
    linkCustomerChannelPhone,
    resolveOrCreateCustomerByIdentity,
} from "@/lib/chatbot/db/channelIdentity";
import {
    ChannelIdentitySchema,
    type ChannelIdentity,
} from "@/src/domain/contracts/identity";

export type WebMenuCustomer = {
    id: string;
    name: string | null;
    phoneE164: string;
    isNew: boolean;
    needsPhone?: boolean;
};

/**
 * Localiza ou cria cliente da empresa por telefone (identidade WhatsApp/web).
 */
export async function resolveWebMenuCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneRaw: string,
    name?: string | null
): Promise<WebMenuCustomer | null> {
    const phone = normalizeBrPhone(phoneRaw);
    if (!phone.ok) return null;

    const viaIdentity = await resolveOrCreateCustomerByIdentity(admin, {
        companyId,
        identity: { channel: "whatsapp", externalId: phone.phoneE164 },
        name: (name ?? "").trim() || "Cliente",
        origem: "web_menu",
    });

    if (viaIdentity?.customerId) {
        // Garante phone_e164 preenchido
        await admin
            .from("customers")
            .update({
                phone: phone.digits,
                phone_e164: phone.phoneE164,
                ...(name?.trim() ? { name: name.trim().slice(0, 120) } : {}),
            })
            .eq("id", viaIdentity.customerId)
            .eq("company_id", companyId);

        const { data } = await admin
            .from("customers")
            .select("id, name")
            .eq("id", viaIdentity.customerId)
            .maybeSingle();

        return {
            id: viaIdentity.customerId,
            name: (data?.name as string | null) ?? name?.trim() ?? null,
            phoneE164: phone.phoneE164,
            isNew: viaIdentity.isNew,
            needsPhone: false,
        };
    }

    // Fallback legado (se RPC indisponível)
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

/**
 * Resolve cliente por identidade de canal (IG/Messenger) no cardápio.
 * Se `needsPhone`, o checkout deve pedir telefone e chamar `linkWebMenuCustomerPhone`.
 */
export async function resolveWebMenuCustomerByChannelIdentity(
    admin: SupabaseClient,
    companyId: string,
    identity: ChannelIdentity | { channel: string; externalId: string },
    name?: string | null
): Promise<WebMenuCustomer | null> {
    const parsed = ChannelIdentitySchema.parse(identity);
    const resolved = await resolveOrCreateCustomerByIdentity(admin, {
        companyId,
        identity: parsed,
        name: (name ?? "").trim() || "Cliente",
        origem: parsed.channel === "web" ? "web_menu" : parsed.channel,
    });
    if (!resolved) return null;

    const { data } = await admin
        .from("customers")
        .select("id, name, phone, phone_e164")
        .eq("id", resolved.customerId)
        .maybeSingle();

    return {
        id: resolved.customerId,
        name: (data?.name as string | null) ?? name?.trim() ?? null,
        phoneE164: (data?.phone_e164 as string | null) || (data?.phone as string | null) || "",
        isNew: resolved.isNew,
        needsPhone: resolved.needsPhone,
    };
}

export async function linkWebMenuCustomerPhone(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    phoneRaw: string
): Promise<WebMenuCustomer | null> {
    const phone = normalizeBrPhone(phoneRaw);
    if (!phone.ok) return null;

    const linked = await linkCustomerChannelPhone(admin, {
        companyId,
        customerId,
        phone: phone.digits,
        phoneE164: phone.phoneE164,
    });
    if (!linked) return null;

    const { data } = await admin
        .from("customers")
        .select("id, name")
        .eq("id", linked.customerId)
        .maybeSingle();

    return {
        id: linked.customerId,
        name: (data?.name as string | null) ?? null,
        phoneE164: phone.phoneE164,
        isNew: false,
        needsPhone: false,
    };
}
