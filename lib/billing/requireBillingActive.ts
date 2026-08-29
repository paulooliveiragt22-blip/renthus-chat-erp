/**
 * Gate de billing server-side — lê pagarme_subscriptions (service_role).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    billingInactiveMessage,
    isBillingAccessAllowed,
    type BillingAccessStatus,
    type BillingGateMode,
} from "@/lib/billing/resolveBillingAccess";
import { resolveTenantAccess } from "@/lib/billing/tenantAccess";

export type {
    BillingAccessStatus,
    BillingGateMode,
} from "@/lib/billing/resolveBillingAccess";

export type BillingGateOk = {
    ok: true;
    status: BillingAccessStatus;
    plan: string | null;
};

export type BillingGateDenied = {
    ok: false;
    status: 402;
    code: "billing_inactive";
    billingStatus: BillingAccessStatus;
    message: string;
    error: string;
};

export type BillingGateResult = BillingGateOk | BillingGateDenied;

export async function requireBillingActive(
    admin: SupabaseClient,
    companyId: string,
    mode: BillingGateMode = "full"
): Promise<BillingGateResult> {
    if (mode === "skip") {
        return { ok: true, status: "active", plan: null };
    }

    const { data, error } = await admin
        .from("pagarme_subscriptions")
        .select("status, trial_ends_at, last_paid_at, plan")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) {
        console.error("[requireBillingActive]", error.message);
        return {
            ok: false,
            status: 402,
            code: "billing_inactive",
            billingStatus: "missing",
            message: billingInactiveMessage("missing"),
            error: billingInactiveMessage("missing"),
        };
    }

    const tenant = resolveTenantAccess(
        data
            ? {
                  status: data.status as string | null,
                  trial_ends_at: data.trial_ends_at as string | null,
                  last_paid_at: data.last_paid_at as string | null,
                  plan: data.plan as string | null,
              }
            : null
    );

    const plan = tenant.plan_intent;
    const effective = tenant.reason;

    if (!isBillingAccessAllowed(effective, mode)) {
        const message = billingInactiveMessage(effective);
        return {
            ok: false,
            status: 402,
            code: "billing_inactive",
            billingStatus: effective,
            message,
            error: message,
        };
    }

    return { ok: true, status: effective, plan };
}
