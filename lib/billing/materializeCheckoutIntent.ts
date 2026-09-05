/**
 * No pagar: converte intent (seleção) em invoice pending antes do PSP.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ensurePlanUpgradeObligation } from "@/lib/billing/ensurePlanUpgradeObligation";
import { ensurePeriodSwitchCheckout } from "@/lib/billing/ensurePeriodSwitchCheckout";

type Admin = ReturnType<typeof createAdminClient>;

export async function materializeCheckoutIntent(
    admin: Admin,
    companyId: string,
    company: {
        name?: string | null;
        nome_fantasia?: string | null;
        email?: string | null;
        whatsapp_phone?: string | null;
        phone?: string | null;
        cnpj?: string | null;
    }
): Promise<void> {
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("pending_upgrade_plan_key, pending_checkout_intent")
        .eq("company_id", companyId)
        .maybeSingle();

    const upgradeTarget = String(sub?.pending_upgrade_plan_key ?? "").trim();
    const intent = String(sub?.pending_checkout_intent ?? "").trim();

    if (upgradeTarget) {
        await ensurePlanUpgradeObligation(admin, {
            companyId,
            targetPlan: upgradeTarget,
        });
        return;
    }

    if (intent === "period_switch") {
        await ensurePeriodSwitchCheckout(admin, { companyId, company });
    }
}
