/**
 * Detecta pergunta de disponibilidade / informação (não é pedido para bootstrap).
 * Ex.: "boa noite tem coca 2l?", "vocês vendem skol?"
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
 * true → não montar carrinho via bootstrap; deixar intent/IA responder.
 */
export function looksLikeAvailabilityOrInfoQuestion(text: string): boolean {
    const raw = String(text ?? "").trim();
    if (!raw) return false;
    const t = norm(raw);
    const hasQuestionMark = raw.includes("?");

    // "tem X?", "ainda tem", "tem disponivel"
    if (
        /\b(tem|vende|vendem|disponivel|disponiveis)\b/u.test(t) &&
        (hasQuestionMark ||
            /^(?:oi|ola|bom dia|boa tarde|boa noite)\b.{0,60}\b(tem|vende)\b/u.test(t))
    ) {
        // Exceção: "quero o que tem de heineken" / "me ve o que tem" ainda é pedido
        if (/\b(quero|me ve|manda|pedir|pedindo|comprar)\b/u.test(t)) return false;
        return true;
    }

    // "voces tem / voce tem / vcs tem"
    if (/\b(voces|voce|vcs)\s+tem\b/u.test(t)) return true;

    // FAQ típico com interrogação e sem verbo de pedido
    if (
        hasQuestionMark &&
        /\b(quanto custa|qual o preco|aceita|faz entrega|horario|abre)\b/u.test(t) &&
        !/\b(quero|me ve|manda|pedir)\b/u.test(t)
    ) {
        return true;
    }

    return false;
}
