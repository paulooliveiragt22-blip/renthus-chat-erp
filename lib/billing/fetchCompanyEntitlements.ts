/**
 * Adapter P2.1 — leitura canônica via rpc_get_company_entitlements.
 */

import "server-only";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

export type CompanyEntitlementsPayload = {
    company_id: string;
    pagarme: {
        status: string;
        plan: string;
        trial_ends_at: string | null;
        last_paid_at: string | null;
        next_billing_at: string | null;
        activated_at: string | null;
    } | null;
    subscription: {
        id: string;
        plan_id: string;
        plan_key: string;
        plan_name: string | null;
        status: string;
        allow_overage: boolean;
    } | null;
    features: string[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
    return v != null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
}

function parseEntitlements(companyId: string, raw: unknown): CompanyEntitlementsPayload {
    const root = asRecord(raw) ?? {};
    const pagarmeRaw = asRecord(root.pagarme);
    const subRaw = asRecord(root.subscription);
    const featuresRaw = Array.isArray(root.features) ? root.features : [];

    const pagarme = pagarmeRaw
        ? {
              status: String(pagarmeRaw.status ?? ""),
              plan: String(pagarmeRaw.plan ?? ""),
              trial_ends_at:
                  pagarmeRaw.trial_ends_at != null ? String(pagarmeRaw.trial_ends_at) : null,
              last_paid_at:
                  pagarmeRaw.last_paid_at != null ? String(pagarmeRaw.last_paid_at) : null,
              next_billing_at:
                  pagarmeRaw.next_billing_at != null ? String(pagarmeRaw.next_billing_at) : null,
              activated_at:
                  pagarmeRaw.activated_at != null ? String(pagarmeRaw.activated_at) : null,
          }
        : null;

    const subscription = subRaw?.id && subRaw?.plan_id
        ? {
              id: String(subRaw.id),
              plan_id: String(subRaw.plan_id),
              plan_key: String(subRaw.plan_key ?? ""),
              plan_name:
                  subRaw.plan_name != null ? String(subRaw.plan_name) : null,
              status: String(subRaw.status ?? "active"),
              allow_overage: Boolean(subRaw.allow_overage),
          }
        : null;

    const features = featuresRaw
        .filter((f): f is string => typeof f === "string" && f.length > 0)
        .map((f) => f.trim());

    return {
        company_id: String(root.company_id ?? companyId),
        pagarme,
        subscription,
        features,
    };
}

export async function fetchCompanyEntitlements(
    admin: AdminClient,
    companyId: string
): Promise<CompanyEntitlementsPayload> {
    const { data, error } = await admin.rpc("rpc_get_company_entitlements", {
        p_company_id: companyId,
    });

    if (error) {
        throw new Error(`rpc_get_company_entitlements: ${error.message}`);
    }

    return parseEntitlements(companyId, data);
}
