/**
 * Detecta confirmação explícita de pedido no PRO V2 (`orderStage`), com bloqueio de negação/cancelamento.
 * Contexto: só é chamado quando `step === pro_awaiting_confirmation`.
 */

/** Prefixos permitidos (mais longos primeiro para casar antes de substrings). */
const AFFIRMATIVE_PREFIXES: readonly string[] = [
    "fechar pedido",
    "pode confirmar",
    "pode fechar",
    "quero confirmar",
    "pode mandar",
    "isso mesmo",
    "pode ser",
    "confirmar",
    "confirmo",
    "fechar",
    "fecha",
    "okay",
    "manda",
    "sim",
    "ok",
];

function startsWithAffirmativePrefix(normalized: string): boolean {
    for (const p of AFFIRMATIVE_PREFIXES) {
        if (normalized === p) return true;
        if (normalized.startsWith(`${p} `)) return true;
        if (normalized.startsWith(`${p},`)) return true;
    }
    return false;
}

export function isExplicitOrderConfirmation(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length > 96) return false;

    const normalized = raw
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();

    if (/\b(nao|nunca|jamais|cancelar|cancela|desistir|desiste)\b/u.test(normalized)) {
        return false;
    }

    const confirmationIds = new Set([
        "confirmar",
        "confirmar_pedido",
        "confirm_order",
        "pro_confirm_order",
        "btn_confirm_order",
        "btn_confirmar",
    ]);
    if (confirmationIds.has(normalized)) return true;

    // Frase curta só com afirmação + pontuação final (legado).
    if (
        /^(sim|ok|okay|confirmo|confirmar|pode\s+confirmar|pode\s+fechar|fechar(?:\s+pedido)?)\W*$/iu.test(
            normalized
        )
    ) {
        return true;
    }

    return startsWithAffirmativePrefix(normalized);
}
