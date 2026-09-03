/**
 * EnsureCheckout — resolve qual obrigação cobrar (setup vs invoice) sem misturar tabelas.
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

/** setup → `setup_payments`; invoice → `invoices` (1ª fatura ou renovação). */
export type CheckoutObligationKind = "setup" | "invoice";

export type CheckoutStrategy = {
    kind: CheckoutObligationKind;
    /** true ⇒ grava/lê `setup_payments`; false ⇒ `invoices`. */
    isFirstPayment: boolean;
    metaType: "setup" | "invoice";
    amountCents: number;
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
 * - pending_setup OU trial com setup>0 → setup
 * - demais (pending_payment, active, overdue, trial setup=0) → invoice
 */
export function resolveCheckoutStrategy(
    status: string | null | undefined,
    plan: string | null | undefined,
    pendingAmountBrl?: number | string | null
): CheckoutStrategy {
    const planKey = String(plan ?? "essencial");
    const setupCents = getSetupPriceCents(planKey);
    const st = String(status ?? "").toLowerCase();

    const isFirstPayment =
        st === "pending_setup" || (st === "trial" && setupCents > 0);

    const kind: CheckoutObligationKind = isFirstPayment ? "setup" : "invoice";
    const fromPending =
        pendingAmountBrl != null && String(pendingAmountBrl).trim() !== ""
            ? Math.round(Number(pendingAmountBrl) * 100)
            : null;

    const amountCents =
        fromPending != null && Number.isFinite(fromPending) && fromPending > 0
            ? fromPending
            : isFirstPayment
              ? getSetupPriceCents(planKey)
              : getMonthlyPriceCents(planKey);

    return {
        kind,
        isFirstPayment,
        metaType: isFirstPayment ? "setup" : "invoice",
        amountCents,
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
    };
    strategy: CheckoutStrategy;
    pendingSetup: PendingCheckoutRow | null;
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
        .select("id, plan, status, pagarme_customer_id, next_billing_at")
        .eq("company_id", companyId)
        .maybeSingle();

    if (subErr) return { error: subErr.message, status: 500 };
    if (!sub) return { error: "Assinatura não encontrada", status: 404 };

    const [{ data: pendingSetup }, { data: pendingInv }] = await Promise.all([
        admin
            .from("setup_payments")
            .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        admin
            .from("invoices")
            .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    const setupRow = (pendingSetup as PendingCheckoutRow | null) ?? null;
    const invRow = (pendingInv as PendingCheckoutRow | null) ?? null;

    const strategyProbe = resolveCheckoutStrategy(
        String(sub.status),
        String(sub.plan ?? "essencial"),
        null
    );
    const pendingForKind = strategyProbe.isFirstPayment ? setupRow : invRow;
    const strategy = resolveCheckoutStrategy(
        String(sub.status),
        String(sub.plan ?? "essencial"),
        pendingForKind?.amount
    );

    return {
        companyId,
        sub: {
            id: String(sub.id),
            plan: String(sub.plan ?? "essencial"),
            status: String(sub.status),
            pagarme_customer_id: (sub.pagarme_customer_id as string | null) ?? null,
            next_billing_at: (sub.next_billing_at as string | null) ?? null,
        },
        strategy,
        pendingSetup: setupRow,
        pendingInv: invRow,
        pendingRecord: pendingForKind,
    };
}

/** Helper de descrição/itemCode alinhado à estratégia. */
export function checkoutOrderLabels(strategy: CheckoutStrategy, planLabel: string) {
    if (strategy.isFirstPayment) {
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
