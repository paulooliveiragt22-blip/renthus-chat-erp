/** Retorna as iniciais de um nome ou número de telefone para exibição em avatares. */
export function getInitials(nameOrPhone: string | null | undefined): string {
    if (!nameOrPhone) return "?";
    const s = nameOrPhone.trim();
    // Se parece número, retorna os últimos 2 dígitos
    if (/^\+?\d[\d\s\-()]+$/.test(s)) return s.replace(/\D/g, "").slice(-2);
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Normaliza número BR para E164 (+5566992285005).
 * Aceita formatos: (66) 99228-5005, 66992285005, +5566992285005, etc.
 */
export function normalizeBrazilToE164(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("55")) {
        const local = digits.slice(2);
        // DDD (2) + 8 dígitos sem o 9 → inserir 9
        if (local.length === 10) {
            const ddd = local.slice(0, 2);
            const num = local.slice(2);
            return `+55${ddd}9${num}`;
        }
        return `+${digits}`;
    }
    // Sem código de país: assume Brasil
    if (digits.length === 10) {
        const ddd = digits.slice(0, 2);
        const num = digits.slice(2);
        return `+55${ddd}9${num}`;
    }
    if (digits.length === 11) return `+55${digits}`;
    return `+${digits}`;
}
