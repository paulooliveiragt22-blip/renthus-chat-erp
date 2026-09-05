/**
 * CPF/CNPJ com dígito verificador (módulo 11).
 * Usado no checkout Pagar.me — a API rejeita documento só com 11/14 dígitos.
 */

export function onlyFiscalDigits(raw: string | null | undefined): string {
    return (raw ?? "").replaceAll(/\D/g, "");
}

function allSameDigits(digits: string): boolean {
    return /^(\d)\1+$/.test(digits);
}

function mod11CheckDigit(base: string, weights: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
        sum += Number(base[i]) * weights[i];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(raw: string | null | undefined): boolean {
    const d = onlyFiscalDigits(raw);
    if (d.length !== 11 || allSameDigits(d)) return false;
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const a = mod11CheckDigit(d.slice(0, 9), w1);
    const b = mod11CheckDigit(d.slice(0, 10), w2);
    return a === Number(d[9]) && b === Number(d[10]);
}

export function isValidCnpj(raw: string | null | undefined): boolean {
    const d = onlyFiscalDigits(raw);
    if (d.length !== 14 || allSameDigits(d)) return false;
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
    const a = mod11CheckDigit(d.slice(0, 12), w1);
    const b = mod11CheckDigit(d.slice(0, 13), w2);
    return a === Number(d[12]) && b === Number(d[13]);
}

export type FiscalDocumentKind = "CPF" | "CNPJ";

export type ClassifiedFiscalDocument =
    | { digits: string; kind: FiscalDocumentKind; valid: true }
    | { digits: string; kind: FiscalDocumentKind | null; valid: false };

export function classifyFiscalDocument(raw: string | null | undefined): ClassifiedFiscalDocument {
    const digits = onlyFiscalDigits(raw);
    if (digits.length === 11) {
        return isValidCpf(digits)
            ? { digits, kind: "CPF", valid: true }
            : { digits, kind: "CPF", valid: false };
    }
    if (digits.length === 14) {
        return isValidCnpj(digits)
            ? { digits, kind: "CNPJ", valid: true }
            : { digits, kind: "CNPJ", valid: false };
    }
    return { digits, kind: null, valid: false };
}
