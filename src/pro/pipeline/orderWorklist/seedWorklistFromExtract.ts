import {
    sealWorklistFromExtract,
    type ExtractedOrderLineInput,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import { pendingTermsReferToSame } from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
import type { OrderLinesExtractPort } from "@/src/pro/ports/orderLinesExtract.port";
import type { OrderWorklist } from "@/src/types/contracts";

const MAX_LINES = 5;

/**
 * Une extract LLM com fallback lexical: se o LLM devolver só 1 termo mas o
 * lexical achar 2+, completa (evita selar só o último SKU ambíguo).
 */
export function mergeExtractedWithLexicalFallback(
    extracted: readonly ExtractedOrderLineInput[],
    fallback: readonly ExtractedOrderLineInput[] | undefined
): ExtractedOrderLineInput[] {
    if (!fallback?.length) return [...extracted];
    if (extracted.length === 0) return [...fallback].slice(0, MAX_LINES);
    const out: ExtractedOrderLineInput[] = [...extracted];
    for (const f of fallback) {
        if (out.some((e) => pendingTermsReferToSame(e.rawTerm, f.rawTerm))) continue;
        out.push({
            rawTerm: f.rawTerm,
            quantity: f.quantity ?? null,
        });
        if (out.length >= MAX_LINES) break;
    }
    return out;
}

export async function seedWorklistFromExtract(params: {
    previous: OrderWorklist | null | undefined;
    userText: string;
    extractPort: OrderLinesExtractPort;
    /** Fallback offline/teste quando extract falha/vazio ou parcial vs multi-item lexical. */
    fallbackExtracted?: readonly ExtractedOrderLineInput[];
    nowIso?: string;
}): Promise<OrderWorklist> {
    let extracted: ExtractedOrderLineInput[] = [];
    try {
        const result = await params.extractPort.extract(params.userText);
        extracted = (result.lines ?? []).map((l) => ({
            rawTerm: l.rawTerm,
            quantity: l.quantity,
        }));
    } catch {
        extracted = [...(params.fallbackExtracted ?? [])];
    }
    extracted = mergeExtractedWithLexicalFallback(extracted, params.fallbackExtracted);
    return sealWorklistFromExtract({
        previous: params.previous,
        userText: params.userText,
        extracted,
        nowIso: params.nowIso,
    });
}
