/**
 * Parse de valor monetário (troco) — anti-falso-positivo em frases com dígito de produto.
 * Não é interpretação de diálogo de vendas (isso é LLM + dialogue act).
 */

function norm(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/**
 * Valor monetário puro (troco). Rejeita frases com produto (“tem coca 2l?” → não é R$ 2).
 */
export function parsePtMoneyInput(text: string): number | null {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 32) return null;

    const flat = norm(raw);
    const withoutMoneyWords = flat
        .replaceAll(/\b(reais?|rs|troco|para|pra|de|no|valor)\b/gu, " ")
        .replaceAll(/r\s*\$/gu, " ")
        .replaceAll(/[^\p{L}]/gu, "");
    if (withoutMoneyWords.length > 0) return null;

    const only = raw.replaceAll(/[^\d,.\s]/g, "").trim();
    if (!only) return null;
    const normalized = only.replaceAll(/\s+/g, "").replaceAll(".", "").replace(",", ".");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

/** Texto claramente não é valor de troco (produto, FAQ, pedido). */
export function looksLikeNonMoneyWhileAwaitingChange(text: string): boolean {
    const t = norm(text);
    if (!t) return false;
    if (parsePtMoneyInput(text) != null) return false;
    if (/\b(tem|quero|vende|coca|pedido|pix|cartao|endereco|sim|nao|ok)\b/u.test(t)) return true;
    if (t.length > 24) return true;
    return false;
}
