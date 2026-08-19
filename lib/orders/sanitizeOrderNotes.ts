/** Observação do cliente no pedido (não por item). */
export const ORDER_NOTES_MAX_LEN = 500;

/** Trim, remove controles, colapsa espaço, teto 500. Vazio → null. */
export function sanitizeOrderNotes(raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw)
        .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replaceAll(/\s+/g, " ")
        .trim()
        .slice(0, ORDER_NOTES_MAX_LEN);
    return s.length > 0 ? s : null;
}
