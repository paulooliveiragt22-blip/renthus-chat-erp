import {
    sealWorklistFromExtract,
    termAppearsInUserText,
    MAX_WORKLIST_LINES,
    type ExtractedOrderLineInput,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import {
    pendingTermsReferToSame,
    isFulfillmentDestinationTerm,
    stripFulfillmentDestination,
    textHasProductOutsideAddress,
} from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
import {
    normalizeExtractedFulfillment,
    type OrderLinesExtractPort,
} from "@/src/pro/ports/orderLinesExtract.port";
import type { FulfillmentType, OrderWorklist } from "@/src/types/contracts";

/**
 * Une extract LLM com fallback lexical: se o LLM devolver só 1 termo mas o
 * lexical achar 2+, completa (evita selar só o último SKU ambíguo).
 */
export function mergeExtractedWithLexicalFallback(
    extracted: readonly ExtractedOrderLineInput[],
    fallback: readonly ExtractedOrderLineInput[] | undefined
): ExtractedOrderLineInput[] {
    if (!fallback?.length) return [...extracted];
    if (extracted.length === 0) return [...fallback].slice(0, MAX_WORKLIST_LINES);
    const out: ExtractedOrderLineInput[] = [...extracted];
    for (const f of fallback) {
        if (out.some((e) => pendingTermsReferToSame(e.rawTerm, f.rawTerm))) continue;
        out.push({
            rawTerm: f.rawTerm,
            quantity: f.quantity ?? null,
        });
        if (out.length >= MAX_WORKLIST_LINES) break;
    }
    return out;
}

/**
 * Descarta termos inventados pelo LLM (ex.: "Cachaça Jamel") **antes** do merge
 * lexical — senão o inventado engole "jamel" e o seal depois o remove (smoke multi-item).
 */
export function sanitizeExtractedOrderTerms(
    rows: readonly ExtractedOrderLineInput[]
): ExtractedOrderLineInput[] {
    const out: ExtractedOrderLineInput[] = [];
    for (const row of rows) {
        const rawTerm = stripFulfillmentDestination(row.rawTerm);
        if (!rawTerm || isFulfillmentDestinationTerm(rawTerm)) continue;
        out.push({ rawTerm, quantity: row.quantity ?? null });
    }
    return out;
}

export function filterExtractedTermsAppearingInUserText(
    extracted: readonly ExtractedOrderLineInput[],
    userText: string
): ExtractedOrderLineInput[] {
    return extracted.filter((row) => termAppearsInUserText(row.rawTerm, userText));
}

export async function seedWorklistFromExtract(params: {
    previous: OrderWorklist | null | undefined;
    userText: string;
    extractPort: OrderLinesExtractPort;
    /** Fallback offline/teste quando extract falha/vazio ou parcial vs multi-item lexical. */
    fallbackExtracted?: readonly ExtractedOrderLineInput[];
    nowIso?: string;
}): Promise<OrderWorklist> {
    const seeded = await seedOrderTurnFromExtract(params);
    return seeded.worklist;
}

/** Worklist + modalidade do extract (ainda sem a regex). */
export async function seedOrderTurnFromExtract(params: {
    previous: OrderWorklist | null | undefined;
    userText: string;
    extractPort: OrderLinesExtractPort;
    fallbackExtracted?: readonly ExtractedOrderLineInput[];
    nowIso?: string;
}): Promise<{ worklist: OrderWorklist; fulfillment: FulfillmentType | null }> {
    let extracted: ExtractedOrderLineInput[] = [];
    let fulfillment: FulfillmentType | null = null;
    try {
        const result = await params.extractPort.extract(params.userText);
        fulfillment = normalizeExtractedFulfillment(result.fulfillment);
        extracted = (result.lines ?? []).map((l) => ({
            rawTerm: l.rawTerm,
            quantity: l.quantity,
        }));
    } catch {
        extracted = [...(params.fallbackExtracted ?? [])];
    }
    extracted = filterExtractedTermsAppearingInUserText(extracted, params.userText);
    extracted = sanitizeExtractedOrderTerms(extracted);
    if (!textHasProductOutsideAddress(params.userText)) extracted = [];
    extracted = mergeExtractedWithLexicalFallback(
        extracted,
        sanitizeExtractedOrderTerms(params.fallbackExtracted ?? [])
    );
    return {
        fulfillment,
        worklist: dropFulfillmentDestinationLines(
            sealWorklistFromExtract({
                previous: params.previous,
                userText: params.userText,
                extracted,
                nowIso: params.nowIso,
            })
        ),
    };
}

/** Tira "pra mim" já selado numa tentativa anterior da mesma frase. */
export function dropFulfillmentDestinationLines(worklist: OrderWorklist): OrderWorklist {
    const lines = worklist.lines.filter((l) => !isFulfillmentDestinationTerm(l.rawTerm));
    if (lines.length === worklist.lines.length) return worklist;
    return { ...worklist, lines };
}
