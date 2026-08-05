/**
 * Heurística de bipagem no PDV: códigos curtos sem espaço (interno/EAN),
 * vs busca textual por nome.
 */

export function looksLikeScanCode(raw: string): boolean {
    const q = raw.trim();
    if (q.length < 3 || q.length > 64) return false;
    if (/\s/u.test(q)) return false;
    if (/^\d{4,}$/u.test(q)) return true;
    // Código interno alfanumérico costuma ter pelo menos um dígito
    return /^[A-Za-z0-9._\-/]{3,}$/u.test(q) && /\d/u.test(q);
}

export function normalizeScanDigits(raw: string): string {
    return raw.replaceAll(/\D/g, "");
}
