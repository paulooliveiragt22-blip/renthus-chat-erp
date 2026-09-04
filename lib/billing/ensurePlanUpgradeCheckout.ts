/**
 * Checkout de upgrade de plano (BN-11): proration até next_billing_at → PIX.
 * Após paid, rpc_fulfill_obligation aplica o plano destino (sem bump next_billing_at).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import {
    normalizePlanKey,
    parseCommercialPlanInput,
    planRank,
    type CommercialPlanKey,
} from "@/lib/billing/planCatalog";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";

type Admin = ReturnType<typeof createAdminClient>;

export type EnsurePlanUpgradeCheckoutResult =
    | {
          mode: "checkout";
          invoiceId: string;
          orderId: string;
          amountCents: number;
          amountBrl: number;
          pixQrCode: string | null;
          pixUrl: string | null;
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
          nextBillingAt: string | null;
      }
    | {
          mode: "applied_free";
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
      };

export async function ensurePlanUpgradeCheckout(
    admin: Admin,
    params: {
        companyId: string;
        targetPlan: string;
        company: {
            name?: string | null;
            nome_fantasia?: string | null;
            email?: string | null;
            whatsapp_phone?: string | null;
            phone?: string | null;
            cnpj?: string | null;
        };
    }
): Promise<EnsurePlanUpgradeCheckoutResult> {
    const toPlan = parseCommercialPlanInput(params.targetPlan);
    if (!toPlan) throw new Error("plan_invalid");

    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, pagarme_customer_id, next_billing_at, seat_quantity"
        )
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");

    const st = String(sub.status ?? "");
    if (st !== "active") throw new Error("subscription_not_eligible");

    const fromPlan = normalizePlanKey(String(sub.plan ?? ""));
    if (!fromPlan) throw new Error("plan_invalid");
    if (planRank(toPlan) <= planRank(fromPlan)) throw new Error("not_an_upgrade");

    // Fonte canônica do valor: banco. DELTA período-aware — anual só sobe para
    // anual (upgrade preserva billing_period) e rateia o já pago (só a diferença
    // anual, prorateada por dias/365). Mensal: delta mensal / 30.
    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_plan_upgrade", {
        p_company_id: params.companyId,
        p_target_plan: toPlan,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as { amount_cents?: number; applied_free?: boolean };
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));

    // Delta zero → aplica na hora (preços iguais / edge).
    if (quote.applied_free === true || amountCents <= 0) {
        const toPricing = await loadPlanPricing(admin, toPlan);
        const { error: upErr } = await admin
            .from("pagarme_subscriptions")
            .update({
                plan: toPlan,
                pending_plan_key: null,
                pending_plan_change_at: null,
                pending_keep_user_ids: null,
                seat_quantity: Math.max(
                    typeof sub.seat_quantity === "number" ? sub.seat_quantity : 1,
                    toPricing.includedSeats
                ),
                updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);
        if (upErr) throw new Error(upErr.message);
        await syncLogicalSubscription(admin, params.companyId, toPlan);
        return { mode: "applied_free", fromPlan, toPlan };
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

    if (pending?.id) {
        invoiceId = pending.id;
        priorOrderId = pending.pagarme_order_id ?? null;
        const catalogBrl = centsToBRL(amountCents);
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
                amount: centsToBRL(amountCents),
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

    // Limpa pending downgrade ao iniciar upgrade pago.
    await admin
        .from("pagarme_subscriptions")
        .update({
            pending_plan_key: null,
            pending_plan_change_at: null,
            pending_keep_user_ids: null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "invoice");
    if (recon.action === "fulfilled") {
        throw new Error("already_fulfilled");
    }

    const customerId =
        typeof sub.pagarme_customer_id === "string" ? sub.pagarme_customer_id : undefined;
    const customerPayload = buildPagarmeCustomerPayload({
        id: params.companyId,
        name: params.company.name ?? null,
        nome_fantasia: params.company.nome_fantasia ?? null,
        email: params.company.email ?? null,
        whatsapp_phone: params.company.whatsapp_phone ?? params.company.phone ?? null,
        cnpj: params.company.cnpj ?? null,
    });

    const created = await createPixInvoiceOrder({
        amountCents,
        description: `Upgrade Renthus ${fromPlan} → ${toPlan} (prorata)`,
        itemCode: "plan_upgrade",
        expiresInSeconds: 3600,
        customerId,
        customer: customerId ? undefined : customerPayload,
        metadata: {
            type: "plan_upgrade",
            company_id: params.companyId,
            subscription_id: String(sub.id),
            plan: toPlan,
            from_plan: fromPlan,
            invoice_id: invoiceId,
        },
    });

    const { order, pixCode, pixUrl } = await resolvePixFromOrder(created);
    if (!pixCode && !pixUrl) {
        throw new Error("pix_payload_missing");
    }

    await admin
        .from("invoices")
        .update({
            pagarme_order_id: order.id,
            pagarme_payment_url: pixUrl,
            pix_qr_code: pixCode,
            amount: centsToBRL(amountCents),
            target_plan_key: toPlan,
        })
        .eq("id", invoiceId);

    return {
        mode: "checkout",
        invoiceId,
        orderId: order.id,
        amountCents,
        amountBrl: centsToBRL(amountCents),
        pixQrCode: pixCode,
        pixUrl,
        fromPlan,
        toPlan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
