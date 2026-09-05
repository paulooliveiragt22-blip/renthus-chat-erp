/** Máscaras de input para checkout de cartão (browser). */

export function formatCardNumberInput(raw: string): string {
    const digits = raw.replaceAll(/\D/g, "").slice(0, 19);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function formatCardExpiryInput(raw: string): string {
    const digits = raw.replaceAll(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function formatCvvInput(raw: string): string {
    return raw.replaceAll(/\D/g, "").slice(0, 4);
}
