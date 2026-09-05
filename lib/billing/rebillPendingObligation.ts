/**
 * Após change-plan: alinha obrigação pending ao preço canônico (RPC).
 * Se order PSP já estiver paid → fulfill. Senão cancela charge e a RPC
 * realinha amount + limpa PIX stale.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { cancelPagarmeChargeBestEffort } from "@/lib/billing/pagarme";
import { fulfillIfPagarmeOrderPaid } from "@/lib/billing/syncPendingObligationFromPsp";
import { billingLog } from "@/lib/billing/billingLog";
import { normalizePlanKey } from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type RebillResult = {
    ok: true;
    action: "fulfilled" | "rebilled" | "noop";
    amount_brl?: number;
};

/**
 * Rebill invoice pending da company após mudança de plano.
 * Amount só via rpc_create_billing_obligation (realign no banco).
 */
export async function rebillPendingObligationAfterPlanChange(
    admin: Admin,
    companyId: string,
    planKeyRaw: string
): Promise<RebillResult> {
    const planKey = normalizePlanKey(planKeyRaw) ?? "essencial";

    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, status, plan, billing_period")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!sub?.id) return { ok: true, action: "noop" };

    const st = String(sub.status ?? "").toLowerCase();

    const { data: inv } = await admin
        .from("invoices")
        .select("id, amount, pagarme_order_id, kind")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .in("kind", ["subscription", "year"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const needsObligation =
        st === "pending_payment" || st === "pending_setup" || st === "trial";
    if (!inv && !needsObligation) return { ok: true, action: "noop" };

    if (inv?.pagarme_order_id) {
        const fulfilled = await fulfillIfPagarmeOrderPaid(
            admin,
            String(inv.pagarme_order_id),
            "invoice"
        );
        if (fulfilled.fulfilled) {
            return { ok: true, action: "fulfilled" };
        }
        await cancelPagarmeChargeBestEffort(String(inv.pagarme_order_id));
    }

    const { data: rpc, error } = await admin.rpc("rpc_create_billing_obligation", {
        p_company_id: companyId,
        p_kind: "subscription",
        p_seat_qty: null,
    });
    if (error) throw new Error(error.message);

    const result = (rpc ?? {}) as {
        status?: string;
        amount_cents?: number;
        invoice_id?: string;
        realigned?: boolean;
    };
    const amountCents = Number(result.amount_cents ?? 0);
    const amountBrl = amountCents / 100;
    const changed =
        result.status === "realigned" ||
        result.realigned === true ||
        result.status === "created";

    billingLog("rebill", changed ? "invoice_rebilled" : "invoice_aligned", {
        company_id: companyId,
        plan: planKey,
        amount_cents: amountCents,
        rpc_status: result.status,
        invoice_id: result.invoice_id,
    });

    return {
        ok: true,
        action: changed ? "rebilled" : "noop",
        amount_brl: Number.isFinite(amountBrl) ? amountBrl : undefined,
    };
}
