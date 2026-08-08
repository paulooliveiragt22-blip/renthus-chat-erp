import { generateText, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfiguredLlmProviderName, resolveLanguageModel } from "@/src/pro/adapters/ai/modelProvider";
import {
    parseOrderLineExtractionJson,
    type OrderLineExtraction,
} from "@/src/domain/contracts/orderExtraction";

/**
 * Extração estruturada **offline** (replay / métrica de divergência).
 * Não faz parte do hot path do pipeline PRO — o cérebro de linguagem é o agent loop
 * (`AiServiceAdapter` + tools). Não reintroduzir no `runProPipeline`.
 */

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

async function debitStructuredExtractUsage(
    admin: SupabaseClient | null | undefined,
    companyId: string | undefined,
    usage: { inputTokens?: number; outputTokens?: number },
    modelId: string | undefined
): Promise<void> {
    if (!admin || !companyId) return;
    try {
        const { debitFromAnthropicUsage } = await import("@/lib/billing/aiWallet");
        await debitFromAnthropicUsage(
            admin,
            companyId,
            { input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0 },
            {
                source: "pro_structured_extract",
                provider: getConfiguredLlmProviderName(),
                model: modelId?.trim() || "unknown",
            }
        );
    } catch {
        /* billing best-effort */
    }
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
 *
 * **Decisão (Fase 6, não reabrir sem motivo novo):** aqui NÃO se usa
 * `generateText({ output: Output.object(schema) })` (padrão das Fases 4/5) —
 * `parseOrderLineExtractionJson` já faz reparo/alias tolerante de JSON
 * (aceita `itens`/`troca`/`dialogo`, cerca de markdown, nomes PT-BR) porque o
 * `SYSTEM` acima pede um contrato solto, não um schema estrito; validação
 * estruturada do SDK rejeitaria essas variações em vez de tolerá-las. Mantido
 * texto livre + parser tolerante existente; só a transporte LLM mudou.
 */
export async function extractOrderLinesStructured(params: {
    userText: string;
    companyId?: string;
    admin?: SupabaseClient | null;
    model?: string;
    /** Seam de teste — injeta `MockLanguageModelV3` de `ai/test` em vez de `resolveLanguageModel()`/rede. */
    modelOverride?: LanguageModel;
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
        const result = await generateText({
            model: params.modelOverride ?? resolveLanguageModel(params.model),
            system: SYSTEM,
            prompt: userContent,
            maxOutputTokens: 400,
            maxRetries: 2,
            abortSignal: AbortSignal.timeout(params.timeoutMs ?? 8_000),
        });

        await debitStructuredExtractUsage(params.admin, params.companyId, result.usage, result.response.modelId);

        return parseOrderLineExtractionJson(result.text);
    } catch (e) {
        console.warn(
            "[structured_extract] failed:",
            e instanceof Error ? e.message : e
        );
        return null;
    }
}
