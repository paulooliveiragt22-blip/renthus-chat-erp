/** Normaliza telefone BR para E.164 (`+55…`) e dígitos locais. */
export function normalizeBrPhone(raw: string): {
    ok: true;
    phoneE164: string;
    digits: string;
} | { ok: false; error: "phone_invalid" } {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) {
        digits = digits.slice(2);
    }
    // celular 11 dígitos (DDD+9…) ou fixo 10
    if (digits.length < 10 || digits.length > 11) {
        return { ok: false, error: "phone_invalid" };
    }
    return {
        ok: true,
        phoneE164: `+55${digits}`,
        digits,
    };
}
