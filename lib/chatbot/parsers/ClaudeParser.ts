/**
 * lib/chatbot/parsers/ClaudeParser.ts
 *
 * Parser nível 1: Claude Haiku via Anthropic SDK.
 *
 * Melhorias implementadas:
 *  - Intent classification integrada (1 call → intent + extração de pedido)
 *  - Prompt enriquecido com regras do RegexParser (stopwords, quantidades, pagamento, endereço)
 *  - Catálogo filtrado por step da sessão (reduz tokens ~70% em steps de checkout)
 *  - Token usage capturado e retornado para logging de custo
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";

// ─── Tipos de intenção ────────────────────────────────────────────────────────

export type MessageIntent =
    | "order"            // pedido de produto (vai para o fluxo normal)
    | "product_question" // dúvida sobre produto, preço, disponibilidade
    | "order_status"     // status / prazo de entrega do pedido atual
    | "cancel"           // quer cancelar o pedido ou item
    | "human"            // quer falar com atendente humano
    | "chitchat";        // saudação, agradecimento, conversa aleatória

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ClaudeParserConfig {
    model?: string;
    threshold?: number;    // confiança mínima (padrão: 0.75)
    maxRetries?: number;
    timeoutMs?: number;
    step?: string;         // step atual da sessão (para filtrar catálogo)
}

const DEFAULT_CONFIG: Required<ClaudeParserConfig> = {
    model: "claude-haiku-4-5-20251001",
    threshold: 0.75,
    maxRetries: 2,
    timeoutMs: 8000,
    step: "",
};

// Steps onde não faz sentido enviar o catálogo completo
const CHECKOUT_STEPS = new Set([
    "checkout_address",
    "checkout_payment",
    "checkout_confirm",
    "awaiting_address_number",
    "awaiting_neighborhood",
    "awaiting_split_order",
    "done",
    "handover",
]);

// ─── Raw result do LLM ────────────────────────────────────────────────────────

interface ClaudeRawResult {
    intent:  MessageIntent;
    action:  "add_to_cart" | "confirm_order" | "low_confidence" | "not_found";
    items:   Array<{
        variantId:   string;
        productName: string;
        qty:         number;
        confidence:  number;
    }>;
    address:   string | null;
    question:  string | null;  // para intent = product_question
    message?:  string;
}

// ─── Resultado estendido (com intent + tokens) ────────────────────────────────

export type ClaudeParseResult = ParseIntentResult & {
    _confidence?:  number;
    _intent?:      MessageIntent;
    _tokensInput?: number;
    _tokensOutput?: number;
};

// ─── Regras do parser Regex (injetadas no prompt para o LLM aprender) ─────────

const STOPWORDS_SAMPLE = [
    "quero","quer","queria","gostaria","pode","manda","mande","traz","traga",
    "me","mim","pra","para","de","do","da","um","uma","o","a","os","as",
    "por favor","pfv","pf","obrigado","obg","oi","ola","bom","dia","tarde","noite",
].join(", ");

const QUANTITY_WORDS_PT = `
"um"/"uma" = 1, "dois"/"duas" = 2, "tres" = 3, "quatro" = 4, "cinco" = 5,
"seis" = 6, "sete" = 7, "oito" = 8, "nove" = 9, "dez" = 10,
"onze" = 11, "doze" = 12, "vinte" = 20`.trim();

const PAYMENT_KEYWORDS = `
pix → "pix"
cartão/crédito/débito/maquininha → "card"
dinheiro/espécie/cash → "cash"
números sozinhos: "1" = cartão, "2" = pix, "3" = dinheiro`.trim();

const ADDRESS_PREFIXES =
    "rua, r., av., avenida, alameda, travessa, estrada, rodovia, praça, setor, quadra";

// ─── Construção do catálogo ───────────────────────────────────────────────────

function buildCatalogText(products: ProductForSearch[], step: string): string {
    // Em steps de checkout não há necessidade de buscar produtos
    if (CHECKOUT_STEPS.has(step)) return "(catálogo não necessário neste passo)";

    return products
        .map((p) => {
            const detail = p.details ? ` ${p.details}` : "";
            const price  = p.unitPrice.toFixed(2).replace(".", ",");
            return `${p.id}|${p.productName}${detail}|R$${price}`;
        })
        .join("\n");
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(input: string, catalogText: string): string {
    return `Você é o assistente de pedidos de uma distribuidora de bebidas via WhatsApp.

═══ CATÁLOGO (variantId|nome|preço) ═══
${catalogText}

═══ MENSAGEM DO CLIENTE ═══
"${input}"

═══ REGRAS DE PARSE ═══
STOPWORDS (ignorar completamente): ${STOPWORDS_SAMPLE}

QUANTIDADES POR EXTENSO: ${QUANTITY_WORDS_PT}

FORMAS DE PAGAMENTO: ${PAYMENT_KEYWORDS}

PREFIXOS DE ENDEREÇO: ${ADDRESS_PREFIXES}

Ao identificar produto, ignore stopwords. Ex: "quero 2 heineken" → qty=2, produto="heineken".
Divisores de múltiplos itens: " e ", " + ", " , ", " mais ", " com ".
  Ex: "2 skol e 1 gelo" → 2 itens.

═══ RESPOSTA ═══
Retorne SOMENTE JSON válido (sem markdown):

{
  "intent": "order" | "product_question" | "order_status" | "cancel" | "human" | "chitchat",
  "action": "add_to_cart" | "confirm_order" | "low_confidence" | "not_found",
  "items": [
    {"variantId": "<id exato do catálogo>", "productName": "<nome>", "qty": <número>, "confidence": <0-1>}
  ],
  "address": "<endereço completo ou null>",
  "question": "<pergunta do cliente se intent=product_question, senão null>",
  "message": "<explicação breve se low_confidence ou not_found>"
}

DEFINIÇÕES DE INTENT:
- "order": cliente quer pedir/comprar produto
- "product_question": pergunta sobre produto, preço, disponibilidade (ex: "tem heineken?", "quanto custa?")
- "order_status": status/prazo do pedido atual (ex: "cadê meu pedido?", "quanto tempo?")
- "cancel": quer cancelar pedido ou item
- "human": quer falar com atendente
- "chitchat": saudação, agradecimento, conversa aleatória

REGRAS DE ACTION (só para intent=order):
- "add_to_cart": produtos identificados mas sem endereço completo
- "confirm_order": produtos E endereço completo com número
- "low_confidence": mensagem provavelmente tem produtos mas confiança < 0.6
- "not_found": não há intenção de pedido (use com intent != "order")
- qty deve ser inteiro ≥ 1
- confidence = 1.0 para match exato, menor para parciais
- items = [] para low_confidence, not_found e intents não-order
- address = null se não houver endereço`;
}

// ─── Parse principal ──────────────────────────────────────────────────────────

export async function parseWithClaude(
    input: string,
    products: ProductForSearch[],
    config: ClaudeParserConfig = {}
): Promise<ClaudeParseResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    if (!products.length && !CHECKOUT_STEPS.has(cfg.step)) {
        return { action: "product_not_found", message: "Catálogo vazio" };
    }

    const client      = new Anthropic();
    const catalogText = buildCatalogText(products, cfg.step);
    const prompt      = buildPrompt(input, catalogText);

    let lastErr: unknown;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

            let raw: ClaudeRawResult;
            let tokensInput  = 0;
            let tokensOutput = 0;

            try {
                const response = await client.messages.create(
                    {
                        model:      cfg.model,
                        max_tokens: 600,
                        messages:   [{ role: "user", content: prompt }],
                    },
                    { signal: controller.signal as any }
                );

                clearTimeout(timer);

                tokensInput  = response.usage?.input_tokens  ?? 0;
                tokensOutput = response.usage?.output_tokens ?? 0;

                const text    = response.content[0]?.type === "text" ? response.content[0].text : "";
                const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
                raw = JSON.parse(jsonStr) as ClaudeRawResult;
            } finally {
                clearTimeout(timer);
            }

            return mapClaudeResult(raw, products, cfg.threshold, tokensInput, tokensOutput);
        } catch (err) {
            lastErr = err;
            if ((err as any)?.name === "AbortError") break;
        }
    }

    throw lastErr;
}

// ─── Mapeamento do resultado bruto ────────────────────────────────────────────

function mapClaudeResult(
    raw: ClaudeRawResult,
    products: ProductForSearch[],
    threshold: number,
    tokensInput:  number,
    tokensOutput: number
): ClaudeParseResult {
    const intent = raw.intent ?? "order";

    // Intents não-order: retorna product_not_found com a intent marcada
    if (intent !== "order") {
        return {
            action:         "product_not_found",
            message:        raw.question ?? raw.message ?? `intent:${intent}`,
            _intent:        intent,
            _tokensInput:   tokensInput,
            _tokensOutput:  tokensOutput,
        };
    }

    if (raw.action === "not_found") {
        return {
            action:        "product_not_found",
            message:       raw.message ?? "Nenhum produto identificado",
            _intent:       intent,
            _tokensInput:  tokensInput,
            _tokensOutput: tokensOutput,
        };
    }

    if (raw.action === "low_confidence") {
        return {
            action:        "low_confidence",
            message:       raw.message ?? "Não entendi o pedido",
            confidence:    0.4,
            _intent:       intent,
            _tokensInput:  tokensInput,
            _tokensOutput: tokensOutput,
        };
    }

    // Mapeia itens usando variantId do catálogo
    const productMap = new Map(products.map((p) => [p.id, p]));
    const items = (raw.items ?? [])
        .filter((it) => it.confidence >= threshold * 0.7 && productMap.has(it.variantId))
        .map((it) => {
            const p = productMap.get(it.variantId)!;
            return {
                productId:      p.productId,
                variantId:      p.id,
                name:           it.productName || p.productName,
                price:          p.unitPrice,
                qty:            Math.max(1, Math.round(it.qty)),
                confidence:     it.confidence,
                packagingSigla: "UN" as const,
                isCase:         false,
            };
        });

    if (!items.length) {
        return {
            action:        "product_not_found",
            message:       "Produtos não encontrados no catálogo",
            _intent:       intent,
            _tokensInput:  tokensInput,
            _tokensOutput: tokensOutput,
        };
    }

    const avgConfidence = items.reduce((s, i) => s + i.confidence, 0) / items.length;
    if (avgConfidence < threshold) {
        return {
            action:        "low_confidence",
            message:       "Confiança baixa",
            confidence:    avgConfidence,
            _intent:       intent,
            _tokensInput:  tokensInput,
            _tokensOutput: tokensOutput,
        };
    }

    const contextUpdate: Record<string, unknown> = {};
    if (raw.address) contextUpdate.delivery_address = raw.address;

    if (raw.action === "confirm_order" && raw.address) {
        return {
            action:  "confirm_order",
            items,
            address: { raw: raw.address, formatted: raw.address },
            contextUpdate,
            _confidence:   avgConfidence,
            _intent:       intent,
            _tokensInput:  tokensInput,
            _tokensOutput: tokensOutput,
        } as any;
    }

    return {
        action:      "add_to_cart",
        items,
        contextUpdate,
        askAddress:  !raw.address,
        _confidence: avgConfidence,
        _intent:     intent,
        _tokensInput:  tokensInput,
        _tokensOutput: tokensOutput,
    } as any;
}
