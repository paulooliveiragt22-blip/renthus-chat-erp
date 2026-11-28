import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    normalizeCampaignPhone,
    omitCampaignPhones,
    parseCampaignPhones,
} from "@/lib/campaigns/parsePhones";

export type AudienceFilter = {
    mode: "all_with_phone" | "ordered_last_days" | "selected";
    orderedLastDays?: number;
    phones?: string[];
    excludePhones?: string[];
};

export type AudienceMember = {
    customerId: string | null;
    phoneE164: string;
};

function normalizePhone(raw: string | null | undefined): string | null {
    return normalizeCampaignPhone(raw);
}

/**
 * Monta audiência de clientes com telefone.
 * MARKETING: filtrar opt-in depois (no enqueue).
 */
export async function buildCampaignAudience(
    admin: SupabaseClient,
    companyId: string,
    filter: AudienceFilter
): Promise<AudienceMember[]> {
    const byPhone = new Map<string, AudienceMember>();

    if (filter.mode === "selected") {
        const wanted = parseCampaignPhones((filter.phones ?? []).join("\n"));
        if (wanted.length === 0) return [];
        const { data: known } = await admin
            .from("customers")
            .select("id, phone, phone_e164")
            .eq("company_id", companyId)
            .limit(10000);
        const customerByPhone = new Map<string, AudienceMember>();
        for (const row of known ?? []) {
            const phone =
                normalizePhone(row.phone_e164 as string | null) ||
                normalizePhone(row.phone as string | null);
            if (!phone) continue;
            const member: AudienceMember = { customerId: row.id as string, phoneE164: phone };
            customerByPhone.set(phone, member);
            customerByPhone.set(phone.replace(/\D/g, "").slice(-11), member);
        }
        return omitCampaignPhones(
            wanted.map((phone) => {
                const hit =
                    customerByPhone.get(phone) ??
                    customerByPhone.get(phone.replace(/\D/g, "").slice(-11));
                return hit ?? { customerId: null, phoneE164: phone };
            }),
            filter.excludePhones
        );
    }

    if (filter.mode === "ordered_last_days") {
        const days = Math.min(365, Math.max(1, filter.orderedLastDays ?? 30));
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const { data: orders } = await admin
            .from("orders")
            .select("customer_id, customer_phone")
            .eq("company_id", companyId)
            .gte("created_at", since)
            .limit(5000);

        const customerIds = [
            ...new Set(
                (orders ?? [])
                    .map((o) => o.customer_id as string | null)
                    .filter(Boolean) as string[]
            ),
        ];
        const phoneByCustomer = new Map<string, string>();
        if (customerIds.length > 0) {
            const { data: customers } = await admin
                .from("customers")
                .select("id, phone, phone_e164")
                .eq("company_id", companyId)
                .in("id", customerIds);
            for (const c of customers ?? []) {
                const phone =
                    normalizePhone(c.phone_e164 as string | null) ||
                    normalizePhone(c.phone as string | null);
                if (phone) phoneByCustomer.set(String(c.id), phone);
            }
        }

        for (const row of orders ?? []) {
            const fromOrder = normalizePhone(row.customer_phone as string | null);
            const fromCust = row.customer_id
                ? phoneByCustomer.get(String(row.customer_id))
                : null;
            const phone = fromOrder || fromCust;
            if (!phone) continue;
            byPhone.set(phone, {
                customerId: (row.customer_id as string | null) ?? null,
                phoneE164: phone,
            });
        }
        return omitCampaignPhones([...byPhone.values()], filter.excludePhones);
    }

    const { data: customers } = await admin
        .from("customers")
        .select("id, phone, phone_e164")
        .eq("company_id", companyId)
        .limit(10000);

    for (const c of customers ?? []) {
        const phone =
            normalizePhone(c.phone_e164 as string | null) ||
            normalizePhone(c.phone as string | null);
        if (!phone) continue;
        byPhone.set(phone, { customerId: c.id as string, phoneE164: phone });
    }

    return omitCampaignPhones([...byPhone.values()], filter.excludePhones);
}

export type CampaignPerson = {
    name: string;
    phone: string;
};

export async function previewCampaignAudience(
    admin: SupabaseClient,
    companyId: string,
    filter: AudienceFilter,
    marketing: boolean
): Promise<{ people: CampaignPerson[]; hidden: number }> {
    const members = await buildCampaignAudience(admin, companyId, filter);
    const visible = marketing
        ? await filterMarketingOptInAudience(admin, companyId, members)
        : members;
    const ids = [...new Set(visible.map((member) => member.customerId).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    for (let index = 0; index < ids.length; index += 200) {
        const slice = ids.slice(index, index + 200);
        const { data } = await admin
            .from("customers")
            .select("id, name")
            .eq("company_id", companyId)
            .in("id", slice);
        for (const row of data ?? []) {
            names.set(String(row.id), String(row.name ?? "").trim() || "Sem nome");
        }
    }
    const people = visible
        .map((member) => ({
            name: (member.customerId && names.get(member.customerId)) || "Sem nome",
            phone: member.phoneE164,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt"));
    return { people, hidden: members.length - visible.length };
}

export async function filterMarketingOptInAudience(
    admin: SupabaseClient,
    companyId: string,
    members: AudienceMember[]
): Promise<AudienceMember[]> {
    const ids = members.map((m) => m.customerId).filter(Boolean) as string[];
    if (ids.length === 0) return [];

    const { data: consents } = await admin
        .from("customer_message_consents")
        .select("customer_id")
        .eq("company_id", companyId)
        .eq("channel", "whatsapp")
        .eq("marketing_opt_in", true)
        .in("customer_id", ids);

    const allowed = new Set((consents ?? []).map((r) => String(r.customer_id)));
    return members.filter((m) => m.customerId && allowed.has(m.customerId));
}
