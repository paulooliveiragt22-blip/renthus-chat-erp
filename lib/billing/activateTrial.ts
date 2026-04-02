/**
 * lib/billing/activateTrial.ts
 *
 * Ativa o trial (30 dias) após pagamento do setup legado (fluxo com setup_payments).
 * O cadastro direto em /signup usa `startFreeTrial` (TRIAL_DAYS, padrão 15) sem Pagar.me.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function activateTrial(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: "bot" | "complete",
    pagarmeCustomerId: string
): Promise<string | undefined> {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    const { data, error } = await admin
        .from("pagarme_subscriptions")
        .upsert(
            {
                company_id:          companyId,
                plan,
                status:              "trial",
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

    // Garante que a empresa está ativa
    await admin
        .from("companies")
        .update({ is_active: true })
        .eq("id", companyId);

    console.log(`[activateTrial] Trial ativado para empresa ${companyId} | plan=${plan}`);
    return data.id;
}
