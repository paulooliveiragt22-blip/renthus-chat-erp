/**
 * lib/chatbot/middleware/intentClassifier.ts
 *
 * Classifica a intenção da mensagem em: order_intent | status_intent |
 * human_intent | faq | greeting | unknown.
 *
 * Nível 1: Regex + IDs de botão (zero tokens de IA).
 * Nível 2: Claude Haiku (fallback para mensagens ambíguas).
 */

import Anthropic from "@anthropic-ai/sdk";
import { clampChatbotInputForRegex, normalize } from "../utils";
import { isPortugueseOrderConfirmation, isPortugueseOrderRejection } from "../pro/confirmationPt";

export type MessageIntent =
    | "order_intent"
    | "status_intent"
    | "human_intent"
    | "faq"
    | "greeting"
    | "unknown";

// ── Regex Level 1 ──────────────────────────────────────────────────────────────
// Vários padrões pequenos (S5843) em vez de um único regex com alta complexidade.
// Quantificadores limitados (S5852 / ReDoS): \s{1,N} em vez de \s+ ilimitado.

function anyPattern(s: string, patterns: RegExp[]): boolean {
    return patterns.some((re) => re.test(s));
}

const ORDER_PATTERNS: RegExp[] = [
    /\bcardapio\b/iu,
    /\bcatalogo\b/iu,
    /\bprodutos?\b/iu,
    /\bbebidas?\b/iu,
    /\bver\s{1,24}(?:card|cat|prod)\b/iu,
    /\bpedir\b/iu,
    /\bcomprar\b/iu,
    /\bquero\s{1,24}(?:pedir|comprar|ver|um|uma|dois?)\b/iu,
    /\bmandar?\s{1,24}/iu,
    /\btraz(?:er)?\b/iu,
    /\bquero\s{1,24}pedir\b/iu,
    /\bfazer\s{1,24}pedido\b/iu,
];

const STATUS_PATTERNS: RegExp[] = [
    /\bmeu\s{1,24}pedido\b/iu,
    /\bstatus\b/iu,
    /\bcad[eê]\b/iu,
    /\bonde\s{1,24}est[aá]\b/iu,
    /\bacompanhar\b/iu,
    /\bprevis[aã]o\s{1,24}de\s{1,24}entrega\b/iu,
    /\bquando\s{1,24}(?:chega|chegar|vai|vai\s{1,24}chegar)\b/iu,
];

const HUMAN_PATTERNS: RegExp[] = [
    /\batendente\b/iu,
    /\bhumano\b/iu,
    /\bpessoa\b/iu,
    /\bsuporte\b/iu,
    /\bajuda\b/iu,
    /\bfalar\s{1,24}com\b/iu,
    /\bchamar\s{1,24}atendente\b/iu,
    /\bpreciso\s{1,24}de\s{1,24}ajuda\b/iu,
];

const GREETING_PATTERNS: RegExp[] = [
    /^oi\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^ol[aá]\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^bom\s+dia\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^boa\s+tarde\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^boa\s+noite\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^al[oô]\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^hey\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^hi\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^e\s+a[ií]\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^boa\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^ola\s{0,40}[!?.,]?\s{0,40}$/iu,
    /^hello\s{0,40}[!?.,]?\s{0,40}$/iu,
];

const FAQ_PATTERNS: RegExp[] = [
    /\bqual\b/iu,
    /\bquanto\b/iu,
    /\bcomo\b/iu,
    /\bonde\b/iu,
    /\bquando\b/iu,
    /\btem\s{1,24}/iu,
    /\bvoc[eê]s?\s{1,24}(?:t[eê]m|vendem|entregam|aceitam|funcionam)\b/iu,
    /\baceita[mn]?\b/iu,
    /\bentreg[am]?\b/iu,
    /\bhora[rs]\s{1,24}de\b/iu,
    /\bfunciona[mn]?\b/iu,
    /\bdisponivel\b/iu,
    /\bvalor\s{1,24}d[oa]\b/iu,
    /\bpre[cç]o\s{1,24}d[oa]\b/iu,
    /\bme\s{1,24}diz\b/iu,
    /\bsaber\s{1,24}se\b/iu,
];

// IDs de botão do menu principal
const BTN_CATALOG = new Set(["btn_catalog", "1"]);
const BTN_STATUS  = new Set(["btn_status",  "2"]);
const BTN_SUPPORT = new Set(["btn_support", "3"]);

const VALID_INTENTS: MessageIntent[] = [
    "order_intent", "status_intent", "human_intent", "faq", "greeting", "unknown",
];

/** Respostas curtas de forma de pagamento / continuação de pedido (PRO com rascunho ativo). */
function isProPaymentOrOrderSnippet(trimmed: string): boolean {
    const t = trimmed.trim();
    if (t.length === 0) return false;
    if (/^(pix|no pix|dinheiro|no dinheiro|cart[aã]o|no cart[aã]o|d[eé]bito|cr[eé]dito)\s*[!.?]*$/iu.test(t)) return true;
    if (t.length <= 24 && /\b(pix|dinheiro|cart[aã]o|d[eé]bito|cr[eé]dito)\b/iu.test(t)) return true;
    if (/^troco\s+(para|de)?\s*R?\$?\s*\d/iu.test(t)) return true;
    return false;
}

export type ClassifyIntentOptions = {
    /**
     * Chatbot PRO com `ai_order_canonical` na sessão — não classificar "sim"/"pix"/"dinheiro" como saudação;
     * manter `order_intent` para o Haiku continuar o pedido ou o servidor fechar após confirmação.
     */
    proActiveCanonicalDraft?: boolean;
};

// ── Classificação ─────────────────────────────────────────────────────────────

export async function classifyIntent(
    text: string,
    _step: string,
    model = "claude-haiku-4-5-20251001",
    options?: ClassifyIntentOptions
): Promise<MessageIntent> {
    const trimmed = clampChatbotInputForRegex(text.trim());
    const norm    = normalize(trimmed);

    if (options?.proActiveCanonicalDraft) {
        if (isPortugueseOrderConfirmation(trimmed) || isPortugueseOrderRejection(trimmed)) {
            return "order_intent";
        }
        if (isProPaymentOrOrderSnippet(trimmed)) return "order_intent";
    }

    // Botões exatos do menu (string fixa, sem ambiguidade)
    if (BTN_CATALOG.has(trimmed)) return "order_intent";
    if (BTN_STATUS.has(trimmed))  return "status_intent";
    if (BTN_SUPPORT.has(trimmed)) return "human_intent";

    // Regex shortcuts (sem custo de IA)
    if (anyPattern(trimmed, GREETING_PATTERNS)) return "greeting";
    if (anyPattern(norm, STATUS_PATTERNS))      return "status_intent";
    if (anyPattern(norm, HUMAN_PATTERNS))       return "human_intent";
    if (anyPattern(norm, FAQ_PATTERNS))         return "faq";
    if (anyPattern(norm, ORDER_PATTERNS))       return "order_intent";

    // Mensagens muito curtas sem match → provavelmente saudação ou desconhecido
    if (trimmed.length <= 3) return "greeting";

    // Claude Haiku para mensagens ambíguas
    try {
        const client = new Anthropic();
        const resp   = await client.messages.create({
            model,
            max_tokens: 10,
            system: `Classify the user's WhatsApp message to a Brazilian delivery store into exactly one intent:
- order_intent: wants to order, buy, browse products or catalog
- status_intent: asking about order status or delivery time
- human_intent: wants to talk to a human attendant
- faq: question about products, prices, delivery area, opening hours, payment methods
- greeting: just saying hello or social message
- unknown: none of the above

Reply with ONLY the intent name in lowercase, nothing else.`,
            messages: [{ role: "user", content: trimmed }],
        });

        const raw = ((resp.content[0] as { text: string }).text ?? "").trim().toLowerCase();
        return VALID_INTENTS.includes(raw as MessageIntent) ? (raw as MessageIntent) : "unknown";
    } catch (err) {
        console.error("[intentClassifier] Claude error:", err);
        return "unknown";
    }
}
