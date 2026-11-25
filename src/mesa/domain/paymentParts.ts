export const MESA_PAYMENT_METHODS = ["cash", "pix", "debit", "card"] as const;

export type MesaPaymentMethod = (typeof MESA_PAYMENT_METHODS)[number];

export const MESA_PAYMENT_LABELS: Record<MesaPaymentMethod, string> = {
    cash: "Dinheiro",
    pix: "Pix",
    debit: "Cartão de débito",
    card: "Cartão de crédito",
};

export function isMesaPaymentMethod(value: string): value is MesaPaymentMethod {
    return (MESA_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Prévia de tela. A soma que vale é a da RPC. */
export function partsRemainder(due: number, amounts: Array<number | null>): number {
    const sum = amounts.reduce<number>((acc, n) => acc + (n != null && Number.isFinite(n) ? n : 0), 0);
    return Math.round((due - sum) * 100) / 100;
}
