import {
    sealWorklistFromExtract,
    type ExtractedOrderLineInput,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import type { OrderLinesExtractPort } from "@/src/pro/ports/orderLinesExtract.port";
import type { OrderWorklist } from "@/src/types/contracts";

export async function seedWorklistFromExtract(params: {
    previous: OrderWorklist | null | undefined;
    userText: string;
    extractPort: OrderLinesExtractPort;
    /** Fallback offline/teste quando extract falha ou devolve vazio e mensagem é multi-item. */
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
    if (extracted.length === 0 && params.fallbackExtracted?.length) {
        extracted = [...params.fallbackExtracted];
    }
    return sealWorklistFromExtract({
        previous: params.previous,
        userText: params.userText,
        extracted,
        nowIso: params.nowIso,
    });
}
