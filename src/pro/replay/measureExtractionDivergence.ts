import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";
import { buildBootstrapSegmentPlanFromExtraction } from "@/src/pro/pipeline/bootstrapSegmentPlan";
import { swapIntentFromExtraction } from "@/src/pro/pipeline/bootstrapSegmentPlan";

export type ExtractionDivergenceCase = {
    text: string;
    extraction: OrderLineExtraction | null;
};

export type ExtractionDivergenceSummary = {
    cases: number;
    withExtraction: number;
    withItems: number;
    withSwap: number;
    withPayment: number;
    planReady: number;
};

/**
 * Resume baseline offline de extrações (sem regex).
 * Usado por testes e `npm run replay -- --extract-diff`.
 */
export function summarizeExtractionDivergence(
    cases: ExtractionDivergenceCase[]
): ExtractionDivergenceSummary {
    let withExtraction = 0;
    let withItems = 0;
    let withSwap = 0;
    let withPayment = 0;
    let planReady = 0;

    for (const c of cases) {
        if (!c.extraction) continue;
        withExtraction += 1;
        if (c.extraction.items.length > 0) withItems += 1;
        if (swapIntentFromExtraction(c.extraction)) withSwap += 1;
        if (c.extraction.paymentMethod) withPayment += 1;
        if (buildBootstrapSegmentPlanFromExtraction(c.extraction)) planReady += 1;
    }

    return {
        cases: cases.length,
        withExtraction,
        withItems,
        withSwap,
        withPayment,
        planReady,
    };
}
