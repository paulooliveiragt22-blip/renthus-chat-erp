/** Vias de cupom (M4). Domínio puro — sem I/O. */

export const PRINT_COPY_TYPES = ["kitchen", "cashier", "driver"] as const;

export type PrintCopyType = (typeof PRINT_COPY_TYPES)[number];

export function isPrintCopyType(v: unknown): v is PrintCopyType {
    return typeof v === "string" && (PRINT_COPY_TYPES as readonly string[]).includes(v);
}

/** Normaliza, dedupe e valida. Descarta valores inválidos. */
export function normalizePrintCopyTypes(input: unknown): PrintCopyType[] {
    const raw = Array.isArray(input) ? input : [];
    const out: PrintCopyType[] = [];
    for (const item of raw) {
        const s = String(item ?? "")
            .trim()
            .toLowerCase();
        if (!isPrintCopyType(s)) continue;
        if (!out.includes(s)) out.push(s);
    }
    return out;
}

/** Remove `driver` quando o pedido não é entrega. */
export function filterCopiesForFulfillment(
    copies: PrintCopyType[],
    fulfillmentType: string | null | undefined
): PrintCopyType[] {
    const ft = String(fulfillmentType ?? "delivery").toLowerCase();
    if (ft === "delivery") return copies;
    return copies.filter((c) => c !== "driver");
}

export function printCopyLabel(c: PrintCopyType): string {
    if (c === "kitchen") return "Cozinha";
    if (c === "driver") return "Entregador";
    return "Caixa";
}

export const DEFAULT_AUTO_PRINT_COPIES: PrintCopyType[] = ["kitchen", "cashier"];
