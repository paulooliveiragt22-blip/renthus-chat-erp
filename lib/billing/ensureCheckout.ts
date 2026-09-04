/**
 * EnsureCheckout — resolve qual obrigação cobrar na tabela unificada `invoices`.
 * Puro + load leve; a rota HTTP orquestra Pagar.me / persistência.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    getMonthlyPriceCents,
    getSetupPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";

type Admin = ReturnType<typeof createAdminClient>;

/** Tipo lógico enviado ao PSP; ambos persistem em `invoices`. */
export type CheckoutObligationKind = "setup" | "invoice";

export type CheckoutStrategy = {
    kind: CheckoutObligationKind;
    isFirstPayment: boolean;
    metaType: "setup" | "invoice";
    amountCents: number;
    /** `year` = ciclo anual (R2-3); canônico vindo de rpc_create_billing_obligation. */
    invoiceKind: "setup" | "subscription" | "year";
};

export type PendingCheckoutRow = {
    id: string;
    amount: number | string | null;
    pagarme_order_id: string | null;
    pagarme_payment_url: string | null;
    pix_qr_code: string | null;
};

/**
 * Decide setup vs invoice a partir do status da assinatura e preço de setup.
 * - pending_setup legado, trial ou pending_payment nunca pago + setup>0 → setup
 * - demais → mensalidade
 * Amount: `opts.amountCents` (DB+seats) ou fallback catálogo (H4.3).
 */
export function resolveCheckoutStrategy(
    status: string | null | undefined,
    plan: string | null | undefined,
    _pendingAmountBrl?: number | string | null,
    lastPaidAt?: string | null,
    opts?: { amountCents?: number }
): CheckoutStrategy {
    const planKey = String(plan ?? "essencial");
    const setupCents = getSetupPriceCents(planKey);
    const st = String(status ?? "").toLowerCase();

    const neverPaid = !lastPaidAt || String(lastPaidAt).trim() === "";
    const isFirstPayment =
        st === "pending_setup" ||
        (st === "trial" && setupCents > 0) ||
        (st === "pending_payment" && neverPaid);

    const chargesSetup = isFirstPayment && setupCents > 0;
    const kind: CheckoutObligationKind = chargesSetup ? "setup" : "invoice";
    const amountCents = chargesSetup
        ? setupCents
        : typeof opts?.amountCents === "number" && opts.amountCents >= 0
          ? Math.floor(opts.amountCents)
          : getMonthlyPriceCents(planKey);

    return {
        kind,
        isFirstPayment,
        metaType: chargesSetup ? "setup" : "invoice",
        amountCents,
        invoiceKind: chargesSetup ? "setup" : "subscription",
    };
}

export type CheckoutContext = {
    companyId: string;
    sub: {
        id: string;
        plan: string;
        status: string;
        pagarme_customer_id: string | null;
        next_billing_at: string | null;
        last_paid_at: string | null;
    };
    strategy: CheckoutStrategy;
    pendingInv: PendingCheckoutRow | null;
    pendingRecord: PendingCheckoutRow | null;
};

/** Carrega sub + pendências e aplica `resolveCheckoutStrategy`. */
export async function loadCheckoutContext(
    admin: Admin,
    companyId: string
): Promise<CheckoutContext | { error: string; status: number }> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, pagarme_customer_id, next_billing_at, last_paid_at, seat_quantity"
        )
        .eq("company_id", companyId)
        .maybeSingle();

    if (subErr) return { error: subErr.message, status: 500 };
    if (!sub) return { error: "Assinatura não encontrada", status: 404 };

    const { loadPlanPricing } = await import("@/lib/billing/loadPlanPricing");
    const { computeMonthlyChargeCents } = await import("@/lib/billing/subscriptionAmount");
    const { attachPromoOnAdesaoIfEligible } = await import("@/lib/billing/attachPromoOnAdesao");

    await attachPromoOnAdesaoIfEligible(admin, companyId);

    const { data: subFresh } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, pagarme_customer_id, next_billing_at, last_paid_at, seat_quantity, billing_period, promo_months_remaining, promo_snapshot, pending_plan_key"
        )
        .eq("company_id", companyId)
        .maybeSingle();

    const subRow = subFresh ?? sub;
    const stLower = String(subRow.status ?? "").toLowerCase();
    const lastPaid = (subRow.last_paid_at as string | null) ?? null;
    const nextMs = subRow.next_billing_at
        ? Date.parse(String(subRow.next_billing_at))
        : Number.NaN;

    type PendingKindRow = PendingCheckoutRow & { kind?: string | null };

    // Obrigação já pendente (subscription|year). Não recria para prepaid ativo.
    const { data: existingPending } = await admin
        .from("invoices")
        .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code, kind")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .in("kind", ["subscription", "year"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const prepaidActive =
        stLower === "active" &&
        Number.isFinite(nextMs) &&
        nextMs > Date.now() &&
        !existingPending;

    let pendingForKind = (existingPending as PendingKindRow | null) ?? null;
    let obligKind: "subscription" | "year" =
        pendingForKind?.kind === "year" ? "year" : "subscription";
    let chargeCents = 0;

    if (prepaidActive) {
        // Rota curto-circuita (already_paid); amount só informativo (lista mensal).
        const pricing = await loadPlanPricing(admin, String(subRow.plan ?? "essencial"));
        const seatQty =
            typeof (subRow as { seat_quantity?: number }).seat_quantity === "number" &&
            (subRow as { seat_quantity: number }).seat_quantity >= 1
                ? (subRow as { seat_quantity: number }).seat_quantity
                : pricing.includedSeats;
        chargeCents = computeMonthlyChargeCents(pricing, seatQty);
    } else {
        // Sempre a RPC: cria ou realinha amount (plano/seats/promo/período).
        const { data: oblig, error: obligErr } = await admin.rpc(
            "rpc_create_billing_obligation",
            { p_company_id: companyId, p_kind: "subscription", p_seat_qty: null }
        );
        if (obligErr) return { error: obligErr.message, status: 500 };
        const o = (oblig ?? {}) as {
            invoice_id?: string;
            kind?: string;
            amount_cents?: number;
        };
        obligKind = o.kind === "year" ? "year" : "subscription";
        chargeCents = Number(o.amount_cents ?? 0);
        if (o.invoice_id) {
            const { data: newInv } = await admin
                .from("invoices")
                .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code, kind")
                .eq("id", o.invoice_id)
                .maybeSingle();
            pendingForKind = (newInv as PendingKindRow | null) ?? null;
        }
    }

    const strategy = resolveCheckoutStrategy(
        String(subRow.status),
        String(subRow.plan ?? "essencial"),
        null,
        lastPaid,
        { amountCents: chargeCents }
    );
    // Kind canônico do banco (subscription|year) — sobrepõe o default mensal.
    strategy.invoiceKind = obligKind;

    // Reconcile order pendente já pago no PSP (webhook perdido) → libera antes do QR.
    if (pendingForKind?.id && pendingForKind.pagarme_order_id) {
        const { reconcileOrCancelLiveOrder } = await import(
            "@/lib/billing/reconcileLivePagarmeOrder"
        );
        const recon = await reconcileOrCancelLiveOrder(
            admin,
            pendingForKind.pagarme_order_id,
            strategy.metaType
        );
        if (recon.action === "fulfilled") {
            pendingForKind = null;
        }
    }

    return {
        companyId,
        sub: {
            id: String(subRow.id),
            plan: String(subRow.plan ?? "essencial"),
            status: String(subRow.status),
            pagarme_customer_id: (subRow.pagarme_customer_id as string | null) ?? null,
            next_billing_at: (subRow.next_billing_at as string | null) ?? null,
            last_paid_at: (subRow.last_paid_at as string | null) ?? null,
        },
        strategy,
        pendingInv: pendingForKind,
        pendingRecord: pendingForKind,
    };
}

/** Helper de descrição/itemCode alinhado à estratégia. */
export function checkoutOrderLabels(strategy: CheckoutStrategy, planLabel: string) {
    if (strategy.kind === "setup") {
        return {
            description: `Taxa de ativação Renthus — Plano ${planLabel}`,
            itemCode: "setup" as const,
            tipoLabel: "Taxa de ativação",
        };
    }
    if (strategy.invoiceKind === "year") {
        return {
            description: `Plano anual Renthus — ${planLabel}`,
            itemCode: "mensalidade" as const,
            tipoLabel: "Plano anual",
        };
    }
    return {
        description: `Mensalidade Renthus — Plano ${planLabel}`,
        itemCode: "mensalidade" as const,
        tipoLabel: "Mensalidade",
    };
}

export function amountBrlFromCents(cents: number): number {
    return centsToBRL(cents);
}
