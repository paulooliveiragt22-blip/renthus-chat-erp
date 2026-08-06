/**
 * Remove UUID / campos internos de catálogo que a IA às vezes ecoa do texto sintético do pick.
 */
export function stripInternalCatalogIdsFromCustomerText(visible: string): string {
    let t = visible;
    if (!t) return t;
    // produto_embalagem_id=uuid ou "com produto_embalagem_id=..."
    t = t.replace(
        /\bproduto[_ ]?embalagem[_ ]?id\s*=\s*[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu,
        ""
    );
    t = t.replace(
        /\b(?:id|uuid)\s*[:=]\s*[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu,
        ""
    );
    // UUID solto (só se parecer id técnico no meio da frase)
    t = t.replace(
        /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu,
        ""
    );
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
    return t;
}

/**
 * Remove afirmações de que o pedido já foi gravado/confirmado na loja ou enviado.
 * Só `orderStage` + RPC podem produzir mensagem canónica de sucesso.
 */
export function stripHallucinatedOrderPersistenceClaims(visible: string): string {
    const raw = visible.trim();
    if (!raw) return raw;
    const flat = raw
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .toLowerCase();

    const claims: RegExp[] = [
        /pedido\s+foi\s+montad/,
        /seu\s+pedido\s+foi\s+montad/,
        /pedido\s+montado/,
        /tudo\s+pronto[!.,]?\s*(seu\s+)?pedido/,
        /aguarde\s+o\s+resumo/,
        /resumo\s+final\s+com\s+o\s+total/,
        /pedido\s+foi\s+confirmad/,
        /seu\s+pedido\s+foi\s+confirmad/,
        /** "Seu pedido já foi confirmado" (advérbio entre sujeito e verbo) */
        /pedido\s+ja\s+foi\s+confirmad/,
        /seu\s+pedido\s+ja\s+foi\s+confirmad/,
        /** Títulos/markdown: "Pedido confirmado:" */
        /pedido\s+confirmado\s*:/,
        /pedido\s+confirmado\s+e\s+/,
        /pedido\s+confirmado[.!]/,
        /** Afirmação de confirmação sem persistência real */
        /confirmado\s+aqui\s+comigo/,
        /pedido\s+(foi\s+)?criad/,
        /criamos\s+(o\s+)?(seu\s+)?pedido/,
        /criei\s+(o\s+)?(seu\s+)?pedido/,
        /gravamos\s+(o\s+)?(seu\s+)?pedido/,
        /pedido\s+gravado/,
        /salvei\s+(o\s+)?(seu\s+)?pedido/,
        /pedido\s+ja\s+esta\s+(no\s+)?sistema/,
        /fechamos\s+(o\s+)?(seu\s+)?pedido\s+no\s+sistema/,
        /saiu\s+pr[ao]\s+entrega/,
        /registramos\s+(o\s+)?(seu\s+)?pedido/,
        /pedido\s+realizado/,
        /ja\s+confirmamos\s+o\s+pedido/,
        /numero\s+do\s+pedido/,
        /codigo\s+do\s+pedido/,
    ];
    if (!claims.some((re) => re.test(flat))) return visible;

    return (
        "Ainda nao registrei seu pedido no sistema da loja.\n\n" +
        "Para fechar aqui, preciso do rascunho validado pelo servidor (itens do catalogo, endereco e pagamento) e depois Confirmar.\n\n" +
        "Se precisar de uma pessoa agora, digite *atendente* ou *humano*."
    );
}
