/**
 * Telefone BR — E.164 para busca (`phone_e164`) e exibição nacional `(DD) 9XXXXXXXX`.
 */

export type BrPhoneNormalized = {
    phoneE164: string;
    /** 11 dígitos: DDD + número (celular com 9). */
    digits: string;
    /** Formato para `customers.phone` e UI: `(11) 912568542` */
    nationalDisplay: string;
};

export function digitsOnlyBr(raw: string): string {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length > 11) {
        digits = digits.slice(2);
    }
    return digits.slice(0, 11);
}

/** Máscara enquanto digita: `(DD) ` + resto. */
export function formatBrPhoneAsYouType(raw: string): string {
    const d = digitsOnlyBr(raw);
    if (d.length === 0) return "";
    if (d.length <= 2) return `(${d}`;
    return `(${d.slice(0, 2)}) ${d.slice(2)}`;
}

export function formatBrPhoneNationalDisplay(digits: string): string {
    const d = digits.replace(/\D/g, "").slice(0, 11);
    if (d.length < 3) return d;
    return `(${d.slice(0, 2)}) ${d.slice(2)}`;
}

export function isCompleteBrMobileNational(display: string): boolean {
    return normalizeBrMobilePhone(display).ok;
}

/** Fixo ou celular (10–11 dígitos) — bot / legado. */
export function normalizeBrPhone(
    raw: string
): { ok: true } & BrPhoneNormalized | { ok: false; error: "phone_invalid" } {
    const digits = digitsOnlyBr(raw);
    if (digits.length < 10 || digits.length > 11) {
        return { ok: false, error: "phone_invalid" };
    }
    return {
        ok: true,
        phoneE164: `+55${digits}`,
        digits,
        nationalDisplay: formatBrPhoneNationalDisplay(digits),
    };
}

/**
 * Celular BR para checkout (IG/Messenger): 11 dígitos, 3º = 9.
 * Formato nacional obrigatório na UI: `(11) 912568542`.
 */
export function normalizeBrMobilePhone(
    raw: string
): { ok: true } & BrPhoneNormalized | { ok: false; error: "phone_invalid" } {
    const digits = digitsOnlyBr(raw);
    if (digits.length !== 11 || digits[2] !== "9") {
        return { ok: false, error: "phone_invalid" };
    }
    return {
        ok: true,
        phoneE164: `+55${digits}`,
        digits,
        nationalDisplay: formatBrPhoneNationalDisplay(digits),
    };
}

/** Compara telefones ignorando máscara / E.164. */
export function brPhoneDigitsEqual(a: string, b: string): boolean {
    const da = digitsOnlyBr(a);
    const db = digitsOnlyBr(b);
    if (!da || !db) return false;
    return da === db;
}
