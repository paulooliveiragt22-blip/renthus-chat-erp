/**
 * Pagamento / troco só a partir do que o cliente disse (não inventar via LLM).
 */

function norm(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/** Cliente falou pix / dinheiro / cartão nesta mensagem. */
export function userTextMentionsPayment(text: string): boolean {
    const t = norm(text);
    if (!t) return false;
    return /\b(pix|dinheiro|especie|cartao|credito|debito|card|cash)\b/u.test(t);
}

/** Cliente pediu troco nesta mensagem. */
export function userTextMentionsChangeFor(text: string): boolean {
    const t = norm(text);
    if (!t) return false;
    return /\btroco\b/u.test(t);
}

/**
 * Valor monetário puro (troco). Rejeita frases com produto (“tem coca 2l?” → não é R$ 2).
 */
export function parsePtMoneyInput(text: string): number | null {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 32) return null;

    const flat = norm(raw);
    /** Letras restantes depois de remover palavras de dinheiro → não é input de troco. */
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

/**
 * Afirmação curta de checkout (endereço / “pode ser”) — não é escolha de pagamento.
 */
export function looksLikeCheckoutAffirmation(text: string): boolean {
    const t = norm(text).replaceAll(/[!?.,]+$/gu, "").trim();
    if (!t || t.length > 40) return false;
    if (userTextMentionsPayment(t)) return false;
    return /^(exatamente|exatament|isso|isso mesmo|certo|perfeito|ok|okay|pode ser|pode|uhum|ahm|sim|ss|s)$/u.test(
        t
    );
}

/** Texto claramente não é valor de troco (produto, FAQ, pedido). */
export function looksLikeNonMoneyWhileAwaitingChange(text: string): boolean {
    const t = norm(text);
    if (!t) return false;
    if (parsePtMoneyInput(text) != null) return false;
    if (looksLikeCheckoutAffirmation(text)) return true;
    if (/\b(tem|quero|vende|coca|pedido|pix|cartao|endereco)\b/u.test(t)) return true;
    if (t.length > 24) return true;
    return false;
}
