// lib/whatsapp/phone.ts — utilitários de telefone compartilhados

/**
 * Normaliza qualquer entrada de telefone brasileiro para E.164.
 * Aceita: "+5566999999999", "66999999999", "5566999999999", "(66) 9 9999-9999".
 */
export function normalizeBrazilToE164(
    input: string
): { ok: true; e164: string } | { ok: false; error: string } {
    const raw = (input ?? "").trim();
    if (!raw) return { ok: false, error: "Telefone obrigatório" };

    if (raw.startsWith("+")) {
        const digits = raw.replace(/\s+/g, "");
        if (/^\+\d{8,16}$/.test(digits)) return { ok: true, e164: digits };
        return { ok: false, error: "Telefone inválido. Ex: +5566999999999" };
    }

    const digits = raw.replace(/\D+/g, "");
    if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 14)
        return { ok: true, e164: `+${digits}` };
    if (digits.length === 10 || digits.length === 11)
        return { ok: true, e164: `+55${digits}` };

    return { ok: false, error: "Use formato BR: 66999999999 (DDD + número)" };
}

/** Retorna os dois primeiros caracteres (iniciais) de um label de contato. */
export function getInitials(label: string): string {
    return (label ?? "")
        .replace("+", "")
        .split(" ")
        .map((p) => p.trim()[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?";
}
