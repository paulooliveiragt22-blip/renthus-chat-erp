/**
 * Materializa invoice plan_upgrade no pagar (create-invoice-checkout).
 * Exige pending_upgrade_plan_key ou target explícito validado via quote RPC.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { centsToBRL } from "@/lib/billing/pagarme";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import {
    normalizePlanKey,
    parseCommercialPlanInput,
    planRank,
    type CommercialPlanKey,
} from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type EnsurePlanUpgradeObligationResult = {
    invoiceId: string;
    amountCents: number;
    amountBrl: number;
    fromPlan: CommercialPlanKey;
    toPlan: CommercialPlanKey;
};

export async function ensurePlanUpgradeObligation(
    admin: Admin,
    params: { companyId: string; targetPlan?: string }
): Promise<EnsurePlanUpgradeObligationResult> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, status, last_paid_at, pending_upgrade_plan_key")
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");
    if (String(sub.status ?? "") !== "active") throw new Error("subscription_not_eligible");

    const lastPaid = sub.last_paid_at;
    if (lastPaid == null || String(lastPaid).trim() === "") {
        throw new Error("never_paid_use_change_plan");
    }

    const fromPlan = normalizePlanKey(String(sub.plan ?? ""));
    if (!fromPlan) throw new Error("plan_invalid");

    const rawTarget =
        parseCommercialPlanInput(params.targetPlan) ??
        parseCommercialPlanInput(String(sub.pending_upgrade_plan_key ?? ""));
    if (!rawTarget) throw new Error("upgrade_target_missing");
    const toPlan = rawTarget;
    if (planRank(toPlan) <= planRank(fromPlan)) throw new Error("not_an_upgrade");

    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_plan_upgrade", {
        p_company_id: params.companyId,
        p_target_plan: toPlan,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as { amount_cents?: number; applied_free?: boolean };
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));
    if (quote.applied_free === true || amountCents <= 0) {
        throw new Error("upgrade_applied_free_use_change_plan");
    }

    let invoiceId: string | null = null;
    let priorOrderId: string | null = null;

    const { data: pending } = await admin
        .from("invoices")
        .select("id, pagarme_order_id, amount, target_plan_key")
        .eq("company_id", params.companyId)
        .eq("status", "pending")
        .eq("kind", "plan_upgrade")
        .maybeSingle();

    const catalogBrl = centsToBRL(amountCents);

    if (pending?.id) {
        invoiceId = pending.id;
        priorOrderId = pending.pagarme_order_id ?? null;
        const sameTarget = pending.target_plan_key === toPlan;
        if (!sameTarget || Math.abs(Number(pending.amount) - catalogBrl) > 0.02) {
            await admin
                .from("invoices")
                .update({
                    amount: catalogBrl,
                    target_plan_key: toPlan,
                    pagarme_order_id: null,
                    pagarme_payment_url: null,
                    pix_qr_code: null,
                })
                .eq("id", pending.id)
                .eq("status", "pending");
            priorOrderId = null;
        }
    } else {
        const { data: created, error: insErr } = await admin
            .from("invoices")
            .insert({
                company_id: params.companyId,
                subscription_id: sub.id,
                amount: catalogBrl,
                status: "pending",
                kind: "plan_upgrade",
                target_plan_key: toPlan,
                due_at: new Date().toISOString(),
            })
            .select("id")
            .single();
        if (insErr) {
            if (isUniqueViolation(insErr)) {
                const { data: again } = await admin
                    .from("invoices")
                    .select("id, pagarme_order_id")
                    .eq("company_id", params.companyId)
                    .eq("status", "pending")
                    .eq("kind", "plan_upgrade")
                    .maybeSingle();
                if (!again?.id) throw new Error(insErr.message);
                invoiceId = again.id;
                priorOrderId = again.pagarme_order_id ?? null;
            } else {
                throw new Error(insErr.message);
            }
        } else {
            invoiceId = created!.id;
        }
    }

    if (!invoiceId) throw new Error("invoice_create_failed");

    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "plan_upgrade");
    if (recon.action === "fulfilled") {
        throw new Error("already_fulfilled");
    }

    return {
        invoiceId,
        amountCents,
        amountBrl: catalogBrl,
        fromPlan,
        toPlan,
    };
}
