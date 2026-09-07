/**
 * CPF/CNPJ com dígito verificador (módulo 11).
 * CNPJ: numérico legado + alfanumérico (IN RFB 2.229/2024) — valor = ASCII − 48.
 * CPF: permanece numérico.
 */

/** Só dígitos (CPF / usos legados). */
export function onlyFiscalDigits(raw: string | null | undefined): string {
    return (raw ?? "").replaceAll(/\D/g, "");
}

/**
 * Normaliza documento fiscal: maiúsculas, remove pontuação.
 * Mantém A–Z e 0–9 (CNPJ alfanumérico); CPF continua só com dígitos na prática.
 */
export function normalizeFiscalDocument(raw: string | null | undefined): string {
    return (raw ?? "")
        .toUpperCase()
        .replaceAll(/[^0-9A-Z]/g, "");
}

function allSameDigits(digits: string): boolean {
    return /^(\d)\1+$/.test(digits);
}

function mod11CheckDigitFromValues(values: number[], weights: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
        sum += values[i]! * weights[i]!;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
}

/** Valor do caractere para DV do CNPJ: ASCII − 48 (dígito 0–9 ou letra A–Z). */
function cnpjCharValue(ch: string): number {
    return ch.charCodeAt(0) - 48;
}

export function isValidCpf(raw: string | null | undefined): boolean {
    const d = onlyFiscalDigits(raw);
    if (d.length !== 11 || allSameDigits(d)) return false;
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const vals = [...d].map((c) => Number(c));
    const a = mod11CheckDigitFromValues(vals.slice(0, 9), w1);
    const b = mod11CheckDigitFromValues(vals.slice(0, 10), w2);
    return a === vals[9] && b === vals[10];
}

/**
 * CNPJ numérico ou alfanumérico (12 primeiras posições [0-9A-Z], DV numérico).
 * Exemplo oficial RFB: 12ABC34501DE35.
 */
export function isValidCnpj(raw: string | null | undefined): boolean {
    const d = normalizeFiscalDocument(raw);
    if (d.length !== 14) return false;
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d)) return false;
    // Rejeita sequência trivial só-dígitos (000…0 etc.)
    if (/^\d{14}$/.test(d) && allSameDigits(d)) return false;

    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const baseVals = [...d.slice(0, 12)].map(cnpjCharValue);
    const a = mod11CheckDigitFromValues(baseVals, w1);
    if (a !== Number(d[12])) return false;
    const b = mod11CheckDigitFromValues([...baseVals, a], w2);
    return b === Number(d[13]);
}

export type FiscalDocumentKind = "CPF" | "CNPJ";

export type ClassifiedFiscalDocument =
    | { digits: string; kind: FiscalDocumentKind; valid: true }
    | { digits: string; kind: FiscalDocumentKind | null; valid: false };

/**
 * Classifica CPF (11 dígitos) vs CNPJ (14 chars).
 * `digits` = forma canônica sem máscara (CNPJ em maiúsculas).
 */
export function classifyFiscalDocument(raw: string | null | undefined): ClassifiedFiscalDocument {
    const normalized = normalizeFiscalDocument(raw);
    if (normalized.length === 11 && /^\d{11}$/.test(normalized)) {
        return isValidCpf(normalized)
            ? { digits: normalized, kind: "CPF", valid: true }
            : { digits: normalized, kind: "CPF", valid: false };
    }
    if (normalized.length === 14) {
        return isValidCnpj(normalized)
            ? { digits: normalized, kind: "CNPJ", valid: true }
            : { digits: normalized, kind: "CNPJ", valid: false };
    }
    return { digits: normalized, kind: null, valid: false };
}
