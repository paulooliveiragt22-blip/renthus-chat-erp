/**
 * Máscaras PT-BR para admin billing (borda UI).
 * DB: centavos (R$) ou centésimos de % (2000 = 20,00%).
 */

/** Centavos → "279,00" (sem símbolo). */
export function centsToBrlInput(cents: number | null | undefined): string {
    if (cents == null || !Number.isFinite(cents)) return "0,00";
    const n = Math.max(0, Math.floor(cents));
    const whole = Math.floor(n / 100);
    const frac = String(n % 100).padStart(2, "0");
    return `${whole.toLocaleString("pt-BR")},${frac}`;
}

/** "279,00" | "R$ 279,00" → centavos. */
export function brlInputToCents(raw: string): number | null {
    const s = raw.replace(/R\$\s?/gi, "").trim();
    if (!s) return null;
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

/** Centésimos de % → "20,00". */
export function percentHundredthsToInput(hundredths: number | null | undefined): string {
    if (hundredths == null || !Number.isFinite(hundredths)) return "0,00";
    const n = Math.max(0, Math.floor(hundredths));
    const whole = Math.floor(n / 100);
    const frac = String(n % 100).padStart(2, "0");
    return `${whole},${frac}`;
}

/** "20,00" | "% 20,00" → centésimos (2000). */
export function percentInputToHundredths(raw: string): number | null {
    const s = raw.replace(/%\s?/g, "").trim();
    if (!s) return null;
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

export function formatBrlFromCents(cents: number): string {
    return (Math.max(0, cents) / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
    });
}
