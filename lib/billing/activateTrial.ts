import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePlanKey } from "@/lib/billing/planCatalog";
import { getDefaultTrialDays } from "@/lib/billing/getDefaultTrialDays";

export async function activateTrial(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: string,
    pagarmeCustomerId: string
): Promise<string | undefined> {
    const trialDays = await getDefaultTrialDays(admin);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);
    const planKey = normalizePlanKey(plan) ?? "essencial";

    const status = trialDays === 0 ? "active" : "trial";

    const { data, error } = await admin
        .from("pagarme_subscriptions")
        .upsert(
            {
                company_id:          companyId,
                plan:                planKey,
                status,
                trial_ends_at:       trialEndsAt.toISOString(),
                activated_at:        new Date().toISOString(),
                pagarme_customer_id: pagarmeCustomerId || null,
            },
            { onConflict: "company_id" }
        )
        .select("id")
        .single();

    if (error) {
        console.error("[activateTrial] Erro ao criar subscription:", error.message);
        return undefined;
    }

    await admin
        .from("companies")
        .update({ is_active: true })
        .eq("id", companyId);

    console.log(
        `[activateTrial] Assinatura ${status} para empresa ${companyId} | plan=${plan} | trialDays=${trialDays}`
    );
    return data.id;
}
