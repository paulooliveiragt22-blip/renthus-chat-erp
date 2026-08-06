import type { LlmPort } from "@/src/pro/ports/llm.port";
import {
    parseOrderLineExtractionJson,
    type OrderLineExtraction,
} from "@/src/domain/contracts/orderExtraction";

const SYSTEM = `Você extrai intenção de pedido em português do Brasil.
Responda APENAS com JSON válido:
{"v":1,"items":[{"searchTerm":"heineken long neck","quantity":2}],"paymentMethod":"pix"|null,"useSavedAddress":false,"addressRaw":null,"swap":null}

Regras:
- searchTerm = termo curto para BUSCA no catálogo (nunca UUID, nunca preço, nunca invente marca).
- Inclua no searchTerm a embalagem se o cliente pediu: caixa/cx/fardo/pacote/unidade (ex.: "uma caixa de skol lata" → searchTerm "skol lata caixa", quantity 1).
- Inclua descritor (lata, long neck, 2 litros) e a marca no searchTerm.
- quantity = número de embalagens pedidas (> 0). "uma caixa" = quantity 1 (da caixa, não das unidades soltas).
- paymentMethod só se o cliente disse pix/dinheiro/cartão; senão null.
- useSavedAddress true se pediu endereço salvo / de sempre.
- Se for só PERGUNTA (ex.: "tem coca 2l?", "vocês vendem skol?", "quanto custa a heineken?") SEM pedir para comprar/mandar: items=[] e swap=null (JSON inválido de propósito — não invente pedido).
- Se for TROCA/SUBSTITUIÇÃO (ex.: "troca o salgadinho pela caixa de 15"):
  items=[] e swap={"removeName":"salgadinho","replaceSearchTerm":"salgadinho caixa de 15","replaceHint":"caixa de 15"}
  removeName = o que tirar do carrinho; replaceSearchTerm = query de busca do substituto.
- Máximo 8 items. Sem markdown. Sem items e sem swap → JSON inválido (não invente).`;

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
 * Uma passada LLM — sem histórico, sem tools.
 * Única fonte de interpretação de itens/qty/pagamento/swap do bootstrap.
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
            purpose: "pro_structured_extract",
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
