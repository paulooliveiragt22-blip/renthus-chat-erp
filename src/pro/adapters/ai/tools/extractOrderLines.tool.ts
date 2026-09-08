/**
 * Tool opcional no agent loop — preferência: selo via OrderLinesExtractPort
 * antes do generateText (ADR 0011 D4). Mantida para o modelo poder re-extrair
 * só quando o servidor pedir (worklist vazia + order_intent).
 */
import { tool } from "ai";
import { z } from "zod";
import {
    pendingSearchTermsFromWorklist,
    sealWorklistFromExtract,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import {
    filterExtractedTermsAppearingInUserText,
    mergeExtractedWithLexicalFallback,
} from "@/src/pro/pipeline/orderWorklist/seedWorklistFromExtract";
import { extractCandidatePendingTermsFromUserText } from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
import type { OrderLinesExtractPort } from "@/src/pro/ports/orderLinesExtract.port";
import type { TurnState } from "./turnState";

export function createExtractOrderLinesTool(deps: {
    extractPort: OrderLinesExtractPort;
    userText: string;
    turnState: TurnState;
}) {
    return tool({
        description:
            "Extrai linhas de pedido (produto + qty opcional) da mensagem atual para a worklist do servidor. Use só se o servidor pedir ou a worklist estiver vazia e o cliente citou produtos. Não invente produtos.",
        inputSchema: z.object({
            reason: z
                .string()
                .nullish()
                .describe("Por que está extraindo agora (debug); opcional."),
        }),
        execute: async () => {
            const prev = deps.turnState.orderWorklist;
            const extracted = await deps.extractPort.extract(deps.userText);
            const appearing = filterExtractedTermsAppearingInUserText(
                (extracted.lines ?? []).map((l) => ({
                    rawTerm: l.rawTerm,
                    quantity: l.quantity,
                })),
                deps.userText
            );
            const withLexical = mergeExtractedWithLexicalFallback(
                appearing,
                extractCandidatePendingTermsFromUserText(deps.userText)
            );
            const next = sealWorklistFromExtract({
                previous: prev,
                userText: deps.userText,
                extracted: withLexical,
            });
            deps.turnState.orderWorklist = next;
            return {
                ok: true,
                line_count: next.lines.length,
                pending_search: pendingSearchTermsFromWorklist(next),
                sealed_hash: next.sealedFromUserTextHash,
                guidance_for_model_pt: [
                    "Worklist selada no servidor. Chame search_produtos para cada pending_search antes de endereço/pagamento.",
                ],
            };
        },
    });
}
