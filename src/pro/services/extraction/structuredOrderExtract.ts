import type { LlmPort } from "@/src/pro/ports/llm.port";
import {
    parseOrderLineExtractionJson,
    type OrderLineExtraction,
} from "@/src/domain/contracts/orderExtraction";

const SYSTEM = `Você extrai intenção de pedido e diálogo de checkout em português do Brasil.
Responda APENAS com JSON válido:
{"v":1,"items":[{"searchTerm":"heineken long neck","quantity":2}],"paymentMethod":"pix"|null,"useSavedAddress":false,"addressRaw":null,"swap":null,"dialogue":null}

dialogue (quando couber) = {"act":"confirm_order"|"add_more"|"decline_add_more"|"affirm_slots"|"quantity_only","quantity":number|null}

Regras de items/swap:
- searchTerm = termo curto para BUSCA no catálogo (nunca UUID, nunca preço, nunca invente marca).
- Inclua no searchTerm a embalagem se o cliente pediu: caixa/cx/fardo/pacote/unidade.
- quantity = número de embalagens pedidas (> 0).
- paymentMethod só se o cliente DISSE pix/dinheiro/cartão nesta mensagem; senão null.
- useSavedAddress true se pediu endereço salvo / de sempre.
- Se for só PERGUNTA (ex.: "tem coca 2l?") SEM comprar: items=[] , dialogue=null, swap=null → JSON inválido de propósito (não invente pedido).
- TROCA: items=[] e swap={"removeName":"...","replaceSearchTerm":"...","replaceHint":"..."}.
- Máximo 8 items. Sem markdown.

Regras de dialogue (interprete linguagem NATURAL — não só "sim"/"não"):
- confirm_order: cliente quer FECHAR/CONFIRMAR o pedido (ex.: "pode fechar", "confirma", "manda ver", "isso fecha").
- add_more: quer ACRESCENTAR mais do produto já oferecido/no carrinho (ex.: "pode adicionar", "manda mais", "quero mais umas"). quantity se disse número.
- decline_add_more: NÃO quer acrescentar agora (ex.: "não", "agora não", "só isso", "pode deixar").
- affirm_slots: confirma endereço/dados mas AINDA NÃO fecha o pedido (ex.: "exatamente", "esse mesmo", "pode ser esse endereço").
- quantity_only: a mensagem é SÓ quantidade para o item oferecido (ex.: "3", "duas", "quero 2"). quantity preenchida; items=[].
- Se a mensagem for pedido novo com produto, prefira items[] e dialogue=null.
- Precisa de items OU swap OU dialogue (pelo menos um).`;

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

export type ExtractSessionHint = {
    hasDraftItems?: boolean;
    draftItemCount?: number;
    step?: string | null;
    hasCatalogOffer?: boolean;
    offeredLabel?: string | null;
    awaitingConfirmation?: boolean;
    awaitingPayment?: boolean;
};

/**
 * Uma passada LLM — sem tools.
 * Inclui atos de diálogo (add_more / confirm / qty) para o servidor executar.
 */
export async function extractOrderLinesStructured(params: {
    llm: LlmPort;
    userText: string;
    companyId?: string;
    model?: string;
    timeoutMs?: number;
    sessionHint?: ExtractSessionHint | null;
}): Promise<OrderLineExtraction | null> {
    const text = params.userText.trim();
    if (!text) return null;

    const hint = params.sessionHint;
    const hintLines: string[] = [];
    if (hint) {
        hintLines.push("Contexto da sessão (não invente fora disso):");
        if (hint.hasDraftItems) {
            hintLines.push(`- Carrinho com ${hint.draftItemCount ?? "?"} item(ns).`);
        } else {
            hintLines.push("- Carrinho vazio.");
        }
        if (hint.hasCatalogOffer) {
            hintLines.push(
                `- SKU oferecido recentemente: ${hint.offeredLabel ?? "item do catálogo"}.`
            );
        }
        if (hint.awaitingConfirmation) {
            hintLines.push("- Aguardando confirmação final do pedido.");
        }
        if (hint.awaitingPayment) {
            hintLines.push("- Aguardando escolha de pagamento (PIX/cartão/dinheiro).");
        }
        if (hint.step) hintLines.push(`- step=${hint.step}`);
    }

    const userContent = [hintLines.length ? hintLines.join("\n") : null, `Cliente: ${text.slice(0, 800)}`]
        .filter(Boolean)
        .join("\n\n");

    try {
        const res = await params.llm.chat({
            system: SYSTEM,
            messages: [{ role: "user", content: userContent }],
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
