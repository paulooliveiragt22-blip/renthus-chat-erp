import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AudienceFilter = {
    /** all_with_phone | ordered_last_days */
    mode: "all_with_phone" | "ordered_last_days";
    orderedLastDays?: number;
};

export type AudienceMember = {
    customerId: string | null;
    phoneE164: string;
};

function normalizePhone(raw: string | null | undefined): string | null {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length < 10) return null;
    if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
    if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
    return digits.startsWith("+") ? digits : `+${digits}`;
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
        return [...byPhone.values()];
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

    return [...byPhone.values()];
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
