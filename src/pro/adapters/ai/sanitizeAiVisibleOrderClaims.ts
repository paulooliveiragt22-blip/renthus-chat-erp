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
        /pedido\s+confirmado\s+e\s+/,
        /pedido\s+confirmado[.!]/,
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
        "Ainda nao registrei seu pedido no sistema da loja. " +
        "Quando o resumo com totais estiver completo, use Confirmar — ou diga o que falta (itens, endereco ou pagamento)."
    );
}
