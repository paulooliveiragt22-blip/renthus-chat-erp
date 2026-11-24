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

/**
 * Histórico: `driver` era “só delivery”. Na prática é a via do **cliente**
 * (vai anexada ao pedido) — imprime em entrega e em retirada.
 */
export function filterCopiesForFulfillment(
    copies: PrintCopyType[],
    _fulfillmentType?: string | null
): PrintCopyType[] {
    return copies;
}

/** Rótulo curto na UI. `driver` = via do cliente (chave legada no banco). */
export function printCopyLabel(c: PrintCopyType): string {
    if (c === "kitchen") return "Cozinha";
    if (c === "driver") return "Cliente";
    return "Caixa";
}

/** Faixa impressa no topo do cupom térmico. */
export function printCopyBanner(c: PrintCopyType): string {
    if (c === "kitchen") return "VIA COZINHA";
    if (c === "driver") return "VIA CLIENTE";
    return "VIA CAIXA";
}

/** Default de auto-print: cozinha, caixa e cliente. */
export const DEFAULT_AUTO_PRINT_COPIES: PrintCopyType[] = ["kitchen", "cashier", "driver"];
