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
    invoiceKind: "setup" | "subscription";
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
 * Amount **sempre** do catálogo (H4.3) — pending stale não dita preço.
 */
export function resolveCheckoutStrategy(
    status: string | null | undefined,
    plan: string | null | undefined,
    _pendingAmountBrl?: number | string | null,
    lastPaidAt?: string | null
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
    const amountCents = chargesSetup ? setupCents : getMonthlyPriceCents(planKey);

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
        .select("id, plan, status, pagarme_customer_id, next_billing_at, last_paid_at")
        .eq("company_id", companyId)
        .maybeSingle();

    if (subErr) return { error: subErr.message, status: 500 };
    if (!sub) return { error: "Assinatura não encontrada", status: 404 };

    const strategyProbe = resolveCheckoutStrategy(
        String(sub.status),
        String(sub.plan ?? "essencial"),
        null,
        (sub.last_paid_at as string | null) ?? null
    );
    const { data: matchingPending } = await admin
        .from("invoices")
        .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .eq("kind", strategyProbe.invoiceKind)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    let pendingForKind = (matchingPending as PendingCheckoutRow | null) ?? null;
    if (!pendingForKind) {
        const { data: anyPending } = await admin
            .from("invoices")
            .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        pendingForKind = (anyPending as PendingCheckoutRow | null) ?? null;
    }

    const strategy = resolveCheckoutStrategy(
        String(sub.status),
        String(sub.plan ?? "essencial"),
        null,
        (sub.last_paid_at as string | null) ?? null
    );

    // H4.3: se pending diverge do catálogo, alinha amount e limpa order stale.
    if (pendingForKind?.id) {
        const catalogBrl = centsToBRL(strategy.amountCents);
        const current = Number(pendingForKind.amount);
        if (
            Number.isFinite(current) &&
            Math.abs(current - catalogBrl) > 0.02
        ) {
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
            } else {
                await admin
                    .from("invoices")
                    .update({
                        amount: catalogBrl,
                        pagarme_order_id: null,
                        pagarme_payment_url: null,
                        pix_qr_code: null,
                    })
                    .eq("id", pendingForKind.id)
                    .eq("status", "pending");
                pendingForKind = {
                    ...pendingForKind,
                    amount: catalogBrl,
                    pagarme_order_id: null,
                    pagarme_payment_url: null,
                    pix_qr_code: null,
                };
            }
        }
    }

    return {
        companyId,
        sub: {
            id: String(sub.id),
            plan: String(sub.plan ?? "essencial"),
            status: String(sub.status),
            pagarme_customer_id: (sub.pagarme_customer_id as string | null) ?? null,
            next_billing_at: (sub.next_billing_at as string | null) ?? null,
            last_paid_at: (sub.last_paid_at as string | null) ?? null,
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
    return {
        description: `Mensalidade Renthus — Plano ${planLabel}`,
        itemCode: "mensalidade" as const,
        tipoLabel: "Mensalidade",
    };
}

export function amountBrlFromCents(cents: number): number {
    return centsToBRL(cents);
}
