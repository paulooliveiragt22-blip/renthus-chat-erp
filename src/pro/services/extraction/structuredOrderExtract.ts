import type { LlmPort } from "@/src/pro/ports/llm.port";
import {
    parseOrderLineExtractionJson,
    type OrderLineExtraction,
} from "@/src/domain/contracts/orderExtraction";

const SYSTEM = `Você extrai itens de pedido em português do Brasil.
Responda APENAS com JSON válido neste formato:
{"v":1,"items":[{"searchTerm":"heineken long neck","quantity":1}],"paymentMethod":"pix"|null,"useSavedAddress":false,"addressRaw":null}

Regras:
- searchTerm = termo curto para BUSCA no catálogo (nunca UUID, nunca preço, nunca invente marca inexistente).
- quantity = número > 0.
- paymentMethod só se o cliente disse pix/dinheiro/cartão; senão null.
- useSavedAddress true se pediu endereço salvo / de sempre.
- Máximo 8 items. Sem markdown.`;

function textFromLlmContent(content: unknown[]): string {
    const parts: string[] = [];
    for (const block of content) {
        if (typeof block === "string") {
            parts.push(block);
            continue;
        }
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
    return parts.join("\n").trim();
}

/**
 * Uma passada LLM barata — sem histórico, sem tools.
 * Usado em sombra (Fase 2); cutover depois.
 */
export async function extractOrderLinesStructured(params: {
    llm: LlmPort;
    userText: string;
    companyId?: string;
    model?: string;
    timeoutMs?: number;
}): Promise<OrderLineExtraction | null> {
    const text = params.userText.trim();
    if (text.length < 4) return null;

    try {
        const res = await params.llm.chat({
            system: SYSTEM,
            messages: [{ role: "user", content: text.slice(0, 800) }],
            maxTokens: 400,
            model: params.model,
            timeoutMs: params.timeoutMs ?? 8_000,
            companyId: params.companyId,
            purpose: "pro_structured_extract_shadow",
        });
        const raw = textFromLlmContent(res.content as unknown[]);
        return parseOrderLineExtractionJson(raw);
    } catch (e) {
        console.warn(
            "[structured_extract] failed:",
            e instanceof Error ? e.message : e
        );
        return null;
    }
}
