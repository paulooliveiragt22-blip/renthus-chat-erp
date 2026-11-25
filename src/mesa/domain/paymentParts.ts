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
    return round2(due - sum);
}

export type SplitLine = { id: string; qty: number; unitPrice: number };

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Prévia da divisão por item. O valor gravado é o que a RPC calcula com a mesma regra. */
export function itemPartAmounts(
    lines: SplitLine[],
    payers: Array<Record<string, number>>,
    serviceFee: number,
): number[] {
    const raw = payers.map((qty) =>
        lines.reduce((sum, line) => sum + (qty[line.id] ?? 0) * line.unitPrice, 0),
    );
    const itemsTotal = round2(raw.reduce((sum, n) => sum + n, 0));
    let last = -1;
    raw.forEach((n, i) => {
        if (n > 0) last = i;
    });
    const subs = raw.map(() => 0);
    let usedSub = 0;
    raw.forEach((n, i) => {
        if (i === last) return;
        subs[i] = round2(n);
        usedSub = round2(usedSub + subs[i]);
    });
    if (last >= 0) subs[last] = round2(itemsTotal - usedSub);

    const fee = round2(serviceFee);
    const shares = subs.map(() => 0);
    let usedFee = 0;
    subs.forEach((sub, i) => {
        if (i === last || itemsTotal <= 0) return;
        shares[i] = round2((fee * sub) / itemsTotal);
        usedFee = round2(usedFee + shares[i]);
    });
    if (last >= 0) shares[last] = round2(fee - usedFee);
    return subs.map((sub, i) => round2(sub + shares[i]));
}

export function lineQtysMatch(lines: SplitLine[], payers: Array<Record<string, number>>): boolean {
    return lines.every((line) => {
        const got = payers.reduce((sum, qty) => sum + (qty[line.id] ?? 0), 0);
        return Math.round(got * 10000) === Math.round(line.qty * 10000);
    });
}
