/**
 * Inicia billing pós-signup: trial (N>0) ou pay-to-start (N=0 → pending_payment + fatura).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { getDefaultTrialDays } from "@/lib/billing/getDefaultTrialDays";
import { createInitialMonthlyInvoice } from "@/lib/billing/createInitialMonthlyInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type StartBillingResult = {
    mode:        "trial" | "pending_payment";
    trialDays:   number;
    paymentRequired: boolean;
};

export async function startBillingAfterSignup(
    admin: Admin,
    companyId: string,
    plan: CommercialPlanKey | string,
    trialDaysOverride?: number
): Promise<StartBillingResult> {
    const trialDays =
        trialDaysOverride != null
            ? trialDaysOverride
            : await getDefaultTrialDays(admin);
    const planKey = normalizePlanKey(plan) ?? "essencial";
    const now = new Date();

    if (trialDays === 0) {
        const { error } = await admin.from("pagarme_subscriptions").upsert(
            {
                company_id:          companyId,
                plan:                planKey,
                status:              "pending_payment",
                trial_ends_at:       now.toISOString(),
                activated_at:        null,
                pagarme_customer_id: null,
            },
            { onConflict: "company_id" }
        );

        if (error) {
            console.error("[startBillingAfterSignup] pending_payment:", error.message);
            throw new Error(error.message);
        }

        await admin
            .from("companies")
            .update({ is_active: false, onboarding_completed_at: null })
            .eq("id", companyId);

        await createInitialMonthlyInvoice(admin, companyId);

        billingLog("signup_billing", "pending_payment", { company_id: companyId, plan: planKey });

        return { mode: "pending_payment", trialDays: 0, paymentRequired: true };
    }

    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    const { error } = await admin.from("pagarme_subscriptions").upsert(
        {
            company_id:          companyId,
            plan:                planKey,
            status:              "trial",
            trial_ends_at:       trialEndsAt.toISOString(),
            activated_at:        now.toISOString(),
            pagarme_customer_id: null,
        },
        { onConflict: "company_id" }
    );

    if (error) {
        console.error("[startBillingAfterSignup] trial:", error.message);
        throw new Error(error.message);
    }

    await admin.from("companies").update({ is_active: true }).eq("id", companyId);

    billingLog("signup_billing", "trial", {
        company_id: companyId,
        plan:       planKey,
        trial_days: trialDays,
        ends_at:    trialEndsAt.toISOString(),
    });

    return { mode: "trial", trialDays, paymentRequired: false };
}

/** @deprecated Use startBillingAfterSignup */
export async function startTrialAfterSignup(
    admin: Admin,
    companyId: string,
    plan: CommercialPlanKey | string
): Promise<void> {
    await startBillingAfterSignup(admin, companyId, plan);
}
