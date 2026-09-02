/**
 * Após change-plan: alinha obrigação pending ao preço canônico do novo plano.
 * Se order PSP já estiver paid → fulfill. Senão tenta cancelar charge e limpa PIX stale.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    cancelPagarmeChargeBestEffort,
    centsToBRL,
    getMonthlyPriceCents,
    getSetupPriceCents,
} from "@/lib/billing/pagarme";
import { fulfillIfPagarmeOrderPaid } from "@/lib/billing/syncPendingObligationFromPsp";
import { billingLog } from "@/lib/billing/billingLog";
import { normalizePlanKey } from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type RebillResult = {
    ok: true;
    action: "fulfilled" | "rebilled" | "noop" | "skipped_setup";
    amount_brl?: number;
};

async function maybeFulfillPaidOrder(
    admin: Admin,
    orderId: string,
    metaType: "invoice" | "setup"
): Promise<boolean> {
    const r = await fulfillIfPagarmeOrderPaid(admin, orderId, metaType);
    return r.fulfilled;
}

/**
 * Rebill invoice/setup pending da company após mudança de plano.
 */
export async function rebillPendingObligationAfterPlanChange(
    admin: Admin,
    companyId: string,
    planKeyRaw: string
): Promise<RebillResult> {
    const planKey = normalizePlanKey(planKeyRaw) ?? "essencial";

    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, status, plan")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!sub?.id) return { ok: true, action: "noop" };

    const st = String(sub.status ?? "").toLowerCase();
    const setupCents = getSetupPriceCents(planKey);
    const isSetupPath =
        st === "pending_setup" || (st === "trial" && setupCents > 0);

    if (isSetupPath) {
        const { data: setup } = await admin
            .from("setup_payments")
            .select("id, amount, pagarme_order_id")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!setup) return { ok: true, action: "skipped_setup" };

        const targetCents = setupCents > 0 ? setupCents : getMonthlyPriceCents(planKey);
        const targetBrl = centsToBRL(targetCents);
        const current = Number(setup.amount);

        if (setup.pagarme_order_id) {
            const fulfilled = await maybeFulfillPaidOrder(admin, setup.pagarme_order_id, "setup");
            if (fulfilled) return { ok: true, action: "fulfilled", amount_brl: targetBrl };
            await cancelPagarmeChargeBestEffort(setup.pagarme_order_id);
        }

        if (Math.abs(current - targetBrl) < 0.009 && !setup.pagarme_order_id) {
            return { ok: true, action: "noop", amount_brl: targetBrl };
        }

        await admin
            .from("setup_payments")
            .update({
                amount: targetBrl,
                plan: planKey,
                pagarme_order_id: null,
                pagarme_payment_url: null,
                pix_qr_code: null,
            })
            .eq("id", setup.id);

        billingLog("rebill", "setup_rebilled", {
            company_id: companyId,
            from: current,
            to: targetBrl,
            plan: planKey,
        });
        return { ok: true, action: "rebilled", amount_brl: targetBrl };
    }

    const { data: inv } = await admin
        .from("invoices")
        .select("id, amount, pagarme_order_id")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!inv) return { ok: true, action: "noop" };

    const targetCents = getMonthlyPriceCents(planKey);
    const targetBrl = centsToBRL(targetCents);
    const current = Number(inv.amount);

    if (inv.pagarme_order_id) {
        const fulfilled = await maybeFulfillPaidOrder(admin, inv.pagarme_order_id, "invoice");
        if (fulfilled) return { ok: true, action: "fulfilled", amount_brl: targetBrl };
        await cancelPagarmeChargeBestEffort(inv.pagarme_order_id);
    }

    if (Math.abs(current - targetBrl) < 0.009 && !inv.pagarme_order_id) {
        return { ok: true, action: "noop", amount_brl: targetBrl };
    }

    await admin
        .from("invoices")
        .update({
            amount: targetBrl,
            pagarme_order_id: null,
            pagarme_payment_url: null,
            pix_qr_code: null,
        })
        .eq("id", inv.id);

    billingLog("rebill", "invoice_rebilled", {
        company_id: companyId,
        from: current,
        to: targetBrl,
        plan: planKey,
    });
    return { ok: true, action: "rebilled", amount_brl: targetBrl };
}
