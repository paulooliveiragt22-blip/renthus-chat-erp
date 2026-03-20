/**
 * lib/chatbot/parsers/ClaudeParser.ts
 *
 * Parser nível 1: Claude Haiku via Anthropic SDK.
 * Extrai itens de pedido e endereço a partir de texto livre, com catálogo compacto injetado no prompt.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";

export interface ClaudeParserConfig {
    model?: string;
    threshold?: number;    // confiança mínima para aceitar (padrão: 0.75)
    maxRetries?: number;
    timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ClaudeParserConfig> = {
    model: "claude-haiku-4-5-20251001",
    threshold: 0.75,
    maxRetries: 2,
    timeoutMs: 8000,
};

interface ClaudeRawResult {
    action: "add_to_cart" | "confirm_order" | "low_confidence" | "not_found";
    items: Array<{
        variantId: string;
        productName: string;
        qty: number;
        confidence: number;
    }>;
    address: string | null;
    message?: string;
}

function buildCatalogText(products: ProductForSearch[]): string {
    // Formato compacto: variantId | productName details | preço
    return products
        .map((p) => {
            const detail = p.details ? ` ${p.details}` : "";
            const price = p.unitPrice.toFixed(2).replace(".", ",");
            return `${p.id}|${p.productName}${detail}|R$${price}`;
        })
        .join("\n");
}

function buildPrompt(input: string, catalogText: string): string {
    return `Você é o parser de pedidos de uma distribuidora de bebidas.

CATÁLOGO (formato: variantId|nome|preço):
${catalogText}

MENSAGEM DO CLIENTE:
"${input}"

Extraia itens de pedido e endereço de entrega. Retorne SOMENTE JSON válido, sem markdown:

{
  "action": "add_to_cart" | "confirm_order" | "low_confidence" | "not_found",
  "items": [
    {"variantId": "<id exato do catálogo>", "productName": "<nome>", "qty": <número>, "confidence": <0-1>}
  ],
  "address": "<endereço completo ou null>",
  "message": "<explicação breve se low_confidence ou not_found>"
}

Regras:
- Use "add_to_cart" quando há produtos identificados mas sem endereço completo
- Use "confirm_order" quando há produtos E endereço completo com número
- Use "low_confidence" quando a mensagem provavelmente tem produtos mas a confiança é < 0.6
- Use "not_found" quando não há intenção de pedido (pergunta, saudação, etc.)
- qty deve ser inteiro ≥ 1
- confidence = 1.0 para match exato, menor para matches parciais
- Retorne items vazio [] para low_confidence e not_found
- Se não tiver endereço, address = null`;
}

export async function parseWithClaude(
    input: string,
    products: ProductForSearch[],
    config: ClaudeParserConfig = {}
): Promise<ParseIntentResult & { _confidence?: number }> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    if (!products.length) {
        return { action: "product_not_found", message: "Catálogo vazio" };
    }

    const client = new Anthropic();
    const catalogText = buildCatalogText(products);
    const prompt = buildPrompt(input, catalogText);

    let lastErr: unknown;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

            let raw: ClaudeRawResult;
            try {
                const response = await client.messages.create(
                    {
                        model: cfg.model,
                        max_tokens: 512,
                        messages: [{ role: "user", content: prompt }],
                    },
                    { signal: controller.signal as any }
                );

                clearTimeout(timer);
                const text = response.content[0]?.type === "text" ? response.content[0].text : "";
                // Strip possible markdown fences
                const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
                raw = JSON.parse(jsonStr) as ClaudeRawResult;
            } finally {
                clearTimeout(timer);
            }

            return mapClaudeResult(raw, products, cfg.threshold);
        } catch (err) {
            lastErr = err;
            // Don't retry on abort (timeout)
            if ((err as any)?.name === "AbortError") break;
        }
    }

    throw lastErr;
}

function mapClaudeResult(
    raw: ClaudeRawResult,
    products: ProductForSearch[],
    threshold: number
): ParseIntentResult & { _confidence?: number } {
    if (raw.action === "not_found") {
        return { action: "product_not_found", message: raw.message ?? "Nenhum produto identificado" };
    }

    if (raw.action === "low_confidence") {
        return {
            action: "low_confidence",
            message: raw.message ?? "Não entendi o pedido",
            confidence: 0.4,
        };
    }

    // Map items using variantId from catalog
    const productMap = new Map(products.map((p) => [p.id, p]));
    const items = (raw.items ?? [])
        .filter((it) => it.confidence >= threshold * 0.7 && productMap.has(it.variantId))
        .map((it) => {
            const p = productMap.get(it.variantId)!;
            return {
                productId: p.productId,
                variantId: p.id,
                name: it.productName || p.productName,
                price: p.unitPrice,
                qty: Math.max(1, Math.round(it.qty)),
                confidence: it.confidence,
                packagingSigla: "UN" as const,
                isCase: false,
            };
        });

    if (!items.length) {
        return { action: "product_not_found", message: "Produtos não encontrados no catálogo" };
    }

    const avgConfidence = items.reduce((s, i) => s + i.confidence, 0) / items.length;
    if (avgConfidence < threshold) {
        return { action: "low_confidence", message: "Confiança baixa", confidence: avgConfidence };
    }

    const contextUpdate: Record<string, unknown> = {};
    if (raw.address) {
        contextUpdate.delivery_address = raw.address;
    }

    if (raw.action === "confirm_order" && raw.address) {
        return {
            action: "confirm_order",
            items,
            address: { raw: raw.address, formatted: raw.address },
            contextUpdate,
            _confidence: avgConfidence,
        } as any;
    }

    return {
        action: "add_to_cart",
        items,
        contextUpdate,
        askAddress: !raw.address,
        _confidence: avgConfidence,
    } as any;
}
