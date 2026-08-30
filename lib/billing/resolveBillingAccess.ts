/**
 * Resolve estado efetivo de billing (puro — testável sem Supabase).
 * Ver docs/CHECKLIST_BILLING_PAYWALL_P0.md (D13–D20).
 */

export type BillingAccessStatus =
    | "trial"
    | "active"
    | "overdue"
    | "pending_payment"
    | "pending_setup"
    | "abandoned"
    | "blocked"
    | "cancelled"
    | "missing"
    | "trial_expired";

export type BillingGateMode = "full" | "billing_self" | "skip";

export type PagarmeSubSnapshot = {
    status: string | null;
    trial_ends_at: string | null;
    last_paid_at: string | null;
    plan: string | null;
};

/** Status efetivo a partir da linha pagarme_subscriptions (+ now). */
export function resolveEffectiveBillingStatus(
    row: PagarmeSubSnapshot | null,
    now: Date = new Date()
): BillingAccessStatus {
    if (!row?.status) return "missing";

    const raw = String(row.status).toLowerCase();

    if (raw === "abandoned") return "abandoned";
    if (raw === "blocked") return "blocked";
    if (raw === "cancelled") return "cancelled";
    if (raw === "pending_payment") return "pending_payment";
    if (raw === "pending_setup") return "pending_setup";
    if (raw === "active") return "active";

    if (raw === "trial") {
        const ends = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
        if (!ends || !Number.isFinite(ends.getTime()) || ends.getTime() <= now.getTime()) {
            return "trial_expired";
        }
        return "trial";
    }

    if (raw === "overdue") {
        if (row.last_paid_at) return "overdue";
        return "pending_payment";
    }

    return "missing";
}

/** Em mode=full, quais status efetivos liberam a API mutável. */
export function isBillingAccessAllowed(
    effective: BillingAccessStatus,
    mode: BillingGateMode
): boolean {
    if (mode === "skip" || mode === "billing_self") return true;

    return effective === "trial" || effective === "active" || effective === "overdue";
}

export function billingInactiveMessage(effective: BillingAccessStatus): string {
    switch (effective) {
        case "pending_payment":
            return "Pagamento necessário para acessar o sistema. Conclua o pagamento em Plano.";
        case "pending_setup":
            return "Taxa de ativação pendente. Conclua o pagamento em Plano.";
        case "trial_expired":
            return "Período de teste encerrado. Regularize o pagamento em Plano.";
        case "blocked":
            return "Assinatura bloqueada. Regularize o pagamento em Plano.";
        case "abandoned":
            return "Assinatura desativada por inatividade. Reative seu plano em /plano/reativar para continuar.";
        case "cancelled":
            return "Assinatura cancelada. Fale com o suporte ou reative o plano.";
        case "missing":
            return "Assinatura não encontrada. Fale com o suporte.";
        default:
            return "Assinatura inativa. Regularize o pagamento em Plano.";
    }
}
