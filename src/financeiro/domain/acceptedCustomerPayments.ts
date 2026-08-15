/**
 * Policy de meios aceitos nos canais do cliente (cardápio web + chatbot + Flow + mesa).
 * Não cadastra método novo no ledger — só liga/desliga o enum à vista.
 */

export const CUSTOMER_FACING_PAYMENT_METHODS = ["cash", "pix", "debit", "card"] as const;

export type CustomerFacingPaymentMethod = (typeof CUSTOMER_FACING_PAYMENT_METHODS)[number];

export type AcceptedCustomerPayments = Record<CustomerFacingPaymentMethod, boolean>;

/** Chave em `companies.settings`. */
export const ACCEPTED_CUSTOMER_PAYMENTS_SETTINGS_KEY = "accepted_customer_payments";

/** Default = hard-code histórico do cardápio/chatbot (sem débito). Não confiar em enabled_payments legado. */
export const DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS: AcceptedCustomerPayments = {
    pix: true,
    cash: true,
    card: true,
    debit: false,
};

export const CUSTOMER_PAYMENT_LABELS: Record<CustomerFacingPaymentMethod, string> = {
    pix: "PIX",
    cash: "Dinheiro",
    card: "Cartão (crédito)",
    debit: "Cartão (débito)",
};

const METHOD_SET = new Set<string>(CUSTOMER_FACING_PAYMENT_METHODS);

export function isCustomerFacingPaymentMethod(
    raw: string | null | undefined
): raw is CustomerFacingPaymentMethod {
    return METHOD_SET.has(String(raw ?? "").trim().toLowerCase());
}

export function parseCustomerFacingPaymentMethod(
    raw: string | null | undefined
): CustomerFacingPaymentMethod | null {
    const s = String(raw ?? "").trim().toLowerCase();
    return isCustomerFacingPaymentMethod(s) ? s : null;
}

/** Normaliza qualquer blob (settings ou body) para policy completa. */
export function normalizeAcceptedCustomerPayments(
    raw: unknown
): AcceptedCustomerPayments {
    const out: AcceptedCustomerPayments = { ...DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS };
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;
    for (const key of CUSTOMER_FACING_PAYMENT_METHODS) {
        if (key in obj) out[key] = Boolean(obj[key]);
    }
    return out;
}

/** Lê de `companies.settings` (objeto completo). Ignora `enabled_payments` legado. */
export function acceptedCustomerPaymentsFromCompanySettings(
    settings: unknown
): AcceptedCustomerPayments {
    if (typeof settings !== "object" || settings == null || Array.isArray(settings)) {
        return { ...DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS };
    }
    const nested = (settings as Record<string, unknown>)[
        ACCEPTED_CUSTOMER_PAYMENTS_SETTINGS_KEY
    ];
    if (nested != null) return normalizeAcceptedCustomerPayments(nested);
    return { ...DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS };
}

export function listEnabledCustomerPayments(
    policy: AcceptedCustomerPayments
): CustomerFacingPaymentMethod[] {
    return CUSTOMER_FACING_PAYMENT_METHODS.filter((m) => policy[m]);
}

export function assertAtLeastOneCustomerPayment(
    policy: AcceptedCustomerPayments
): { ok: true } | { ok: false; error: "no_payment_methods" } {
    if (listEnabledCustomerPayments(policy).length === 0) {
        return { ok: false, error: "no_payment_methods" };
    }
    return { ok: true };
}

export function assertCustomerPaymentAllowed(
    policy: AcceptedCustomerPayments,
    method: string | null | undefined
):
    | { ok: true; method: CustomerFacingPaymentMethod }
    | { ok: false; error: "payment_invalid" | "payment_not_accepted" } {
    const parsed = parseCustomerFacingPaymentMethod(method);
    if (!parsed) return { ok: false, error: "payment_invalid" };
    if (!policy[parsed]) return { ok: false, error: "payment_not_accepted" };
    return { ok: true, method: parsed };
}

export function firstEnabledCustomerPayment(
    policy: AcceptedCustomerPayments
): CustomerFacingPaymentMethod {
    return listEnabledCustomerPayments(policy)[0] ?? "pix";
}
