/**
 * Extract focado só em linhas de pedido para OrderWorklist (ADR 0011).
 * Distinto de `extractOrderLinesStructured` (replay/offline) — este é o selo do agent loop.
 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
    getConfiguredLlmProviderName,
    resolveLanguageModel,
} from "@/src/pro/adapters/ai/modelProvider";
import type {
    OrderLinesExtractPort,
    OrderLinesExtractResult,
} from "@/src/pro/ports/orderLinesExtract.port";

const extractSchema = z.object({
    lines: z
        .array(
            z.object({
                raw_term: z.string().describe("Termo curto para busca no catálogo (como o cliente citou)."),
                quantity: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .nullable()
                    .describe("Quantidade se o cliente disse número; null se não disse."),
            })
        )
        .max(15),
});

const SYSTEM = `Extraia APENAS produtos que o cliente quer PEDIR nesta mensagem (PT-BR).
Regras:
- raw_term = termo de busca curto (marca/produto); inclua embalagem no termo só se o cliente pediu (caixa, fardo…).
- quantity = número de embalagens se explícito; senão null (NÃO invente 1).
- Ignore cumprimentos, entrega, pagamento, troco, endereço.
- Máximo 15 lines. Se for só pergunta sem compra, lines=[].
- Nunca invente produto que não apareça na mensagem.`;

export class LlmOrderLinesExtractAdapter implements OrderLinesExtractPort {
    constructor(
        private readonly opts?: {
            modelOverride?: LanguageModel;
            timeoutMs?: number;
        }
    ) {}

    async extract(userText: string): Promise<OrderLinesExtractResult> {
        const text = String(userText ?? "").trim();
        if (!text) return { lines: [] };

        const result = await generateText({
            model: this.opts?.modelOverride ?? resolveLanguageModel(),
            system: SYSTEM,
            prompt: `Cliente: ${text.slice(0, 800)}`,
            maxOutputTokens: 700,
            maxRetries: 1,
            abortSignal: AbortSignal.timeout(this.opts?.timeoutMs ?? 8_000),
            output: Output.object({ schema: extractSchema }),
        });

        void getConfiguredLlmProviderName; // keep import used if tree-shaken differently
        const obj = result.output;
        const lines = (obj?.lines ?? []).map((l) => ({
            rawTerm: String(l.raw_term ?? "").trim(),
            quantity:
                l.quantity != null && Number.isFinite(l.quantity) && l.quantity >= 1
                    ? Math.floor(l.quantity)
                    : null,
        }));
        return { lines: lines.filter((l) => l.rawTerm.length >= 2) };
    }
}

/** Fake determinístico para testes — lexical split multi-item. */
export class FakeOrderLinesExtractAdapter implements OrderLinesExtractPort {
    constructor(private readonly fixed?: OrderLinesExtractResult) {}

    async extract(userText: string): Promise<OrderLinesExtractResult> {
        if (this.fixed) return this.fixed;
        const { extractCandidatePendingTermsFromUserText } = await import(
            "@/src/pro/domain/orderWorklist/extractCandidateTerms"
        );
        const terms = extractCandidatePendingTermsFromUserText(userText);
        return {
            lines: terms.map((t) => ({
                rawTerm: t.rawTerm,
                quantity: t.quantity,
            })),
        };
    }
}
