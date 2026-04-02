/**
 * Inicia trial gratuito no cadastro (sem pagamento no Pagar.me).
 * Após o prazo, o cron em charge/route gera a fatura PIX.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const TRIAL_DAYS = Math.max(1, Math.min(90, Number(process.env.TRIAL_DAYS ?? "15")));

export function getTrialDays(): number {
    return TRIAL_DAYS;
}

export async function startTrialAfterSignup(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: "bot" | "complete"
): Promise<void> {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    const { error } = await admin.from("pagarme_subscriptions").upsert(
        {
            company_id:          companyId,
            plan,
            status:              "trial",
            trial_ends_at:       trialEndsAt.toISOString(),
            activated_at:        new Date().toISOString(),
            pagarme_customer_id: null,
        },
        { onConflict: "company_id" }
    );

    if (error) {
        console.error("[startFreeTrial] Erro ao criar assinatura trial:", error.message);
        throw new Error(error.message);
    }

    await admin.from("companies").update({ is_active: true }).eq("id", companyId);

    console.log(
        `[startFreeTrial] Trial de ${TRIAL_DAYS}d para empresa ${companyId} | plano=${plan} | até ${trialEndsAt.toISOString()}`
    );
}
