/**
 * Heurística barata (sem LLM) para estimar quantos produtos distintos o cliente citou numa
 * mensagem livre — usada só como "piso" para garantir que `search_produtos` rode pelo menos
 * uma vez por item plausível antes do turno fechar via `respond_to_customer`.
 *
 * NÃO extrai nomes de produto (isso é trabalho do modelo/catálogo) — só evita que o modelo
 * esqueça um item citado junto de outro em conectores comuns (bug real de smoke: "quero skol
 * e original" resolveu só "original", "skol" sumiu do pedido). Auto-relato do próprio modelo
 * (`respond_to_customer.pending_items`, ver `shouldForceSearchForPendingMentions`) não é
 * confiável sozinho — o modelo simplesmente não reportou no caso real observado.
 */

const CONNECTOR_WORD_RE = /\s+(?:e|mais|tamb[ée]m)\s+/giu;
const CONNECTOR_SYMBOL_RE = /\s*[,+]\s*/gu;
const MAX_ESTIMATE = 3;
const MIN_SEGMENT_LEN = 3;
/** Instruções sintéticas do servidor (pick de botão, nudges internos) não têm texto do cliente. */
const SYNTHETIC_TEXT_RE = /^\[interno\]|^\[instru[cç][aã]o interna\]/iu;

export function estimateMinDistinctProductMentions(userText: string): number {
    const text = String(userText ?? "").trim();
    if (!text || SYNTHETIC_TEXT_RE.test(text)) return 1;
    const segments = text
        .split(CONNECTOR_WORD_RE)
        .flatMap((s) => s.split(CONNECTOR_SYMBOL_RE))
        .map((s) => s.trim())
        .filter((s) => s.length >= MIN_SEGMENT_LEN);
    if (segments.length <= 1) return 1;
    return Math.min(segments.length, MAX_ESTIMATE);
}
