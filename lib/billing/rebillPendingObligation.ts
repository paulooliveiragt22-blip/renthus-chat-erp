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

/** Cancela invoice pending do tipo oposto para não manter obrigação obsoleta. */
async function voidOppositePending(
    admin: Admin,
    companyId: string,
    keep: "setup" | "invoice"
): Promise<void> {
    const oppositeKind = keep === "setup" ? "subscription" : "setup";
    const { data: rows } = await admin
        .from("invoices")
        .select("id, pagarme_order_id")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .eq("kind", oppositeKind);

    for (const row of rows ?? []) {
        if (row.pagarme_order_id) {
            const metaType = oppositeKind === "setup" ? "setup" : "invoice";
            const paid = await fulfillIfPagarmeOrderPaid(
                admin,
                String(row.pagarme_order_id),
                metaType
            );
            if (paid.fulfilled) {
                billingLog("rebill", "opposite_fulfilled_instead_of_void", {
                    company_id: companyId,
                    kind: oppositeKind,
                    order_id: row.pagarme_order_id,
                });
                continue;
            }
            await cancelPagarmeChargeBestEffort(String(row.pagarme_order_id));
        }
        await admin
            .from("invoices")
            .update({
                status: "cancelled",
                pagarme_order_id: null,
                pagarme_payment_url: null,
                pix_qr_code: null,
            })
            .eq("id", row.id)
            .eq("status", "pending");
    }
    if ((rows ?? []).length > 0) {
        billingLog("rebill", "voided_opposite_invoices", {
            company_id: companyId,
            kind: oppositeKind,
            count: (rows ?? []).length,
        });
    }
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
        await voidOppositePending(admin, companyId, "setup");

        const { data: setup } = await admin
            .from("invoices")
            .select("id, amount, pagarme_order_id")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .eq("kind", "setup")
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
            .from("invoices")
            .update({
                amount: targetBrl,
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

    await voidOppositePending(admin, companyId, "invoice");

    const { data: inv } = await admin
        .from("invoices")
        .select("id, amount, pagarme_order_id")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .eq("kind", "subscription")
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
