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

/** Máscara progressiva CPF (11) / CNPJ (14) enquanto digita. */
export function formatHolderDocumentInput(raw: string): string {
    const d = raw.replaceAll(/\D/g, "").slice(0, 14);
    if (d.length <= 11) {
        return d
            .replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d)/, "$1.$2")
            .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
        .replace(/^(\d{2})(\d)/, "$1.$2")
        .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1/$2")
        .replace(/(\d{4})(\d)/, "$1-$2");
}
