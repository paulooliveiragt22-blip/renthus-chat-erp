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

/** Máscara progressiva CPF (11) / CNPJ (14, numérico ou alfanumérico). */
export function formatHolderDocumentInput(raw: string): string {
    const d = raw
        .toUpperCase()
        .replaceAll(/[^0-9A-Z]/g, "")
        .slice(0, 14);
    // Enquanto ≤11 e só dígitos → máscara CPF
    if (d.length <= 11 && /^\d*$/.test(d)) {
        return d
            .replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    // CNPJ XX.XXX.XXX/XXXX-XX (12 primeiras podem ser A–Z)
    const a = d.slice(0, 2);
    const b = d.slice(2, 5);
    const c = d.slice(5, 8);
    const e = d.slice(8, 12);
    const f = d.slice(12, 14);
    let out = a;
    if (b) out += `.${b}`;
    if (c) out += `.${c}`;
    if (e) out += `/${e}`;
    if (f) out += `-${f}`;
    return out;
}
