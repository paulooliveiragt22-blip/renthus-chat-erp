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

export type MessageIntent =
    | "order_intent"
    | "status_intent"
    | "human_intent"
    | "faq"
    | "greeting"
    | "unknown";

// ── Regex Level 1 ──────────────────────────────────────────────────────────────

// Quantificadores limitados (S5852 / ReDoS): \s{1,N} em vez de \s+ ilimitado
const ORDER_RE = /\b(?:cardapio|catalogo|produtos?|bebidas?|ver\s{1,24}(?:card|cat|prod)|pedir|comprar|quero\s{1,24}(?:pedir|comprar|ver|um|uma|dois?)|mandar?\s{1,24}|traz(?:er)?|quero\s{1,24}pedir|fazer\s{1,24}pedido)\b/iu;
const STATUS_RE  = /\b(?:meu\s{1,24}pedido|status|cad[eê]|onde\s{1,24}est[aá]|acompanhar|previs[aã]o\s{1,24}de\s{1,24}entrega|quando\s{1,24}(?:chega|chegar|vai|vai\s{1,24}chegar))\b/iu;
const HUMAN_RE   = /\b(?:atendente|humano|pessoa|suporte|ajuda|falar\s{1,24}com|chamar\s{1,24}atendente|preciso\s{1,24}de\s{1,24}ajuda)\b/iu;
const GREETING_RE = /^(?:oi|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite|al[oô]|hey|hi|e\s+a[ií]|boa|ola|hello)\s{0,40}[!?.,]?\s{0,40}$/iu;
const FAQ_RE     = /\b(?:qual|quanto|como|onde|quando|tem\s{1,24}|voc[eê]s?\s{1,24}(?:t[eê]m|vendem|entregam|aceitam|funcionam)|aceita[mn]?|entreg[am]?|hora[rs]\s{1,24}de|funciona[mn]?|disponivel|valor\s{1,24}d[oa]|pre[cç]o\s{1,24}d[oa]|me\s{1,24}diz|saber\s{1,24}se)\b/iu;

// IDs de botão do menu principal
const BTN_CATALOG = new Set(["btn_catalog", "1"]);
const BTN_STATUS  = new Set(["btn_status",  "2"]);
const BTN_SUPPORT = new Set(["btn_support", "3"]);

const VALID_INTENTS: MessageIntent[] = [
    "order_intent", "status_intent", "human_intent", "faq", "greeting", "unknown",
];

// ── Classificação ─────────────────────────────────────────────────────────────

export async function classifyIntent(
    text: string,
    _step: string,
    model = "claude-haiku-4-5-20251001"
): Promise<MessageIntent> {
    const trimmed = clampChatbotInputForRegex(text.trim());
    const norm    = normalize(trimmed);

    // Botões exatos do menu (string fixa, sem ambiguidade)
    if (BTN_CATALOG.has(trimmed)) return "order_intent";
    if (BTN_STATUS.has(trimmed))  return "status_intent";
    if (BTN_SUPPORT.has(trimmed)) return "human_intent";

    // Regex shortcuts (sem custo de IA)
    if (GREETING_RE.test(trimmed)) return "greeting";
    if (STATUS_RE.test(norm))      return "status_intent";
    if (HUMAN_RE.test(norm))       return "human_intent";
    if (FAQ_RE.test(norm))         return "faq";
    if (ORDER_RE.test(norm))       return "order_intent";

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
