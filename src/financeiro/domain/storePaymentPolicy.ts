/**
 * Policy de meios aceitos na loja (PDV, Pedidos admin, fechamento mesa).
 * Prazo é separado — não misturar com canais do cliente.
 */

export const STORE_IMMEDIATE_METHODS = ["cash", "pix", "debit", "card"] as const;
export type StoreImmediateMethod = (typeof STORE_IMMEDIATE_METHODS)[number];

export const STORE_PRAZO_METHODS = [
    "credit_installment",
    "boleto",
    "promissoria",
    "cheque",
] as const;
export type StorePrazoMethod = (typeof STORE_PRAZO_METHODS)[number];

/** Alias PDV UI → ledger */
export const PDV_METHOD_TO_LEDGER: Record<string, string> = {
    credit: "credit_installment",
    a_prazo: "credit_installment",
    debit_card: "debit",
    credit_card: "card",
};

export type AcceptedStorePayments = Record<StoreImmediateMethod, boolean>;
export type AcceptedStorePrazo = Record<StorePrazoMethod, boolean>;

export const ACCEPTED_STORE_PAYMENTS_KEY = "accepted_store_payments";
export const ACCEPTED_STORE_PRAZO_KEY = "accepted_store_prazo";

export const DEFAULT_ACCEPTED_STORE_PAYMENTS: AcceptedStorePayments = {
    pix: true,
    cash: true,
    card: true,
    debit: true,
};

export const DEFAULT_ACCEPTED_STORE_PRAZO: AcceptedStorePrazo = {
    credit_installment: true,
    boleto: true,
    promissoria: true,
    cheque: true,
};

const IMMEDIATE_SET = new Set<string>(STORE_IMMEDIATE_METHODS);
const PRAZO_SET = new Set<string>(STORE_PRAZO_METHODS);

export function normalizeStoreImmediate(raw: unknown): AcceptedStorePayments {
    const out = { ...DEFAULT_ACCEPTED_STORE_PAYMENTS };
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;
    for (const key of STORE_IMMEDIATE_METHODS) {
        if (key in obj) out[key] = Boolean(obj[key]);
    }
    return out;
}

export function normalizeStorePrazo(raw: unknown): AcceptedStorePrazo {
    const out = { ...DEFAULT_ACCEPTED_STORE_PRAZO };
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;
    for (const key of STORE_PRAZO_METHODS) {
        if (key in obj) out[key] = Boolean(obj[key]);
    }
    return out;
}

export function storePaymentsFromCompanySettings(settings: unknown): {
    immediate: AcceptedStorePayments;
    prazo: AcceptedStorePrazo;
} {
    if (typeof settings !== "object" || settings == null || Array.isArray(settings)) {
        return {
            immediate: { ...DEFAULT_ACCEPTED_STORE_PAYMENTS },
            prazo: { ...DEFAULT_ACCEPTED_STORE_PRAZO },
        };
    }
    const s = settings as Record<string, unknown>;
    return {
        immediate: normalizeStoreImmediate(s[ACCEPTED_STORE_PAYMENTS_KEY]),
        prazo: normalizeStorePrazo(s[ACCEPTED_STORE_PRAZO_KEY]),
    };
}

export function normalizePdvPaymentMethod(raw: string): string {
    const s = String(raw ?? "").trim().toLowerCase();
    return PDV_METHOD_TO_LEDGER[s] ?? s;
}

export function isStorePrazoMethod(method: string): boolean {
    const m = normalizePdvPaymentMethod(method);
    return PRAZO_SET.has(m) || ["credit", "boleto", "cheque", "promissoria"].includes(m);
}

export function assertStorePaymentAllowed(
    immediate: AcceptedStorePayments,
    prazo: AcceptedStorePrazo,
    method: string | null | undefined
): { ok: true; method: string } | { ok: false; error: "payment_invalid" | "payment_not_accepted" } {
    const normalized = normalizePdvPaymentMethod(method ?? "");
    if (!normalized) return { ok: false, error: "payment_invalid" };

    if (isStorePrazoMethod(normalized)) {
        const ledger = normalized === "credit" ? "credit_installment" : normalized;
        if (!PRAZO_SET.has(ledger as StorePrazoMethod)) {
            return { ok: false, error: "payment_invalid" };
        }
        if (!prazo[ledger as StorePrazoMethod]) {
            return { ok: false, error: "payment_not_accepted" };
        }
        return { ok: true, method: ledger };
    }

    if (!IMMEDIATE_SET.has(normalized as StoreImmediateMethod)) {
        return { ok: false, error: "payment_invalid" };
    }
    if (!immediate[normalized as StoreImmediateMethod]) {
        return { ok: false, error: "payment_not_accepted" };
    }
    return { ok: true, method: normalized };
}

export const STORE_IMMEDIATE_LABELS: Record<StoreImmediateMethod, string> = {
    pix: "PIX",
    cash: "Dinheiro",
    card: "Cartão (crédito)",
    debit: "Cartão (débito)",
};

export const STORE_PRAZO_LABELS: Record<StorePrazoMethod, string> = {
    credit_installment: "A prazo (crediário)",
    boleto: "Boleto",
    promissoria: "Promissória",
    cheque: "Cheque",
};

export function assertAtLeastOneStorePayment(
    immediate: AcceptedStorePayments,
    prazo: AcceptedStorePrazo
): { ok: true } | { ok: false } {
    const anyImmediate = STORE_IMMEDIATE_METHODS.some((k) => immediate[k]);
    const anyPrazo = STORE_PRAZO_METHODS.some((k) => prazo[k]);
    if (anyImmediate || anyPrazo) return { ok: true };
    return { ok: false };
}
