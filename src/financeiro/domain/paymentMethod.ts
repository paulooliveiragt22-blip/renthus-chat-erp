export const PAYMENT_METHODS = [
    "cash",
    "pix",
    "debit",
    "card",
    "credit_installment",
    "boleto",
    "promissoria",
    "cheque",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PRAZO_METHODS: ReadonlySet<string> = new Set([
    "credit_installment",
    "boleto",
    "promissoria",
    "cheque",
    "credit",
]);

export function isPrazoMethod(method: string | null | undefined): boolean {
    return PRAZO_METHODS.has(String(method ?? "").trim().toLowerCase());
}
