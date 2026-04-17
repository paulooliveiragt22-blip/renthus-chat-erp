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
