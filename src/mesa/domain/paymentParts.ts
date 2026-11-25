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

export type PayerBasis = "value" | "item";

export type SplitPayerInput = {
    basis: PayerBasis;
    amount: number | null;
    qty: Record<string, number>;
};

/**
 * Prévia da folha mista. Sem pagador por valor, o último item absorve o centavo.
 * Com pagador por valor, a taxa do item é só a parte dele; o restante fica no valor digitado.
 */
export function splitPreview(
    lines: SplitLine[],
    payers: SplitPayerInput[],
    due: number,
    serviceFee: number,
): { amounts: Array<number | null>; remainder: number; qtyOk: boolean } {
    const itemsTotal = round2(lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0));
    const fee = round2(serviceFee);
    const hasItem = payers.some((payer) => payer.basis === "item");
    const hasValue = payers.some((payer) => payer.basis === "value");
    const qtyOk = !hasItem || lines.every((line) => {
        const got = payers.reduce((sum, payer) => sum + (payer.basis === "item" ? (payer.qty[line.id] ?? 0) : 0), 0);
        const same = Math.round(got * 10000) === Math.round(line.qty * 10000);
        const within = Math.round(got * 10000) <= Math.round(line.qty * 10000);
        return hasValue ? within && got >= 0 : same;
    });

    let amounts: Array<number | null>;
    if (!hasItem) {
        amounts = payers.map((payer) => payer.amount);
    } else if (!hasValue) {
        amounts = itemPartAmounts(lines, payers.map((payer) => payer.qty), fee);
    } else {
        amounts = payers.map((payer) => {
            if (payer.basis === "value") return payer.amount;
            const raw = lines.reduce((sum, line) => sum + (payer.qty[line.id] ?? 0) * line.unitPrice, 0);
            const share = itemsTotal <= 0 ? 0 : round2((fee * raw) / itemsTotal);
            return round2(round2(raw) + share);
        });
    }
    return { amounts, remainder: partsRemainder(due, amounts), qtyOk };
}
