import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";
import { diffExtractionVsRegexBootstrap } from "@/src/pro/pipeline/shadowStructuredExtract";
import { buildBootstrapSegmentPlan } from "@/src/pro/pipeline/bootstrapSegmentPlan";

export type ExtractionDivergenceCase = {
    text: string;
    /** Extração LLM (ou golden). Se null, só conta regex. */
    extraction: OrderLineExtraction | null;
};

export type ExtractionDivergenceSummary = {
    cases: number;
    withExtraction: number;
    equalTerms: number;
    divergeTerms: number;
    paymentAgree: number;
    paymentDisagree: number;
    llmWouldBecomePrimary: number;
};

/**
 * Mede divergência offline (golden / cassete) — sem custo LLM.
 * Usado por testes e `npm run replay -- … --extract-diff` com fixture.
 */
export function summarizeExtractionDivergence(
    cases: ExtractionDivergenceCase[]
): ExtractionDivergenceSummary {
    let withExtraction = 0;
    let equalTerms = 0;
    let divergeTerms = 0;
    let paymentAgree = 0;
    let paymentDisagree = 0;
    let llmWouldBecomePrimary = 0;

    for (const c of cases) {
        const diff = diffExtractionVsRegexBootstrap(c.text, c.extraction);
        if (c.extraction) {
            withExtraction += 1;
            if (diff.equalTerms) equalTerms += 1;
            else divergeTerms += 1;

            const payR = diff.paymentRegex ?? null;
            const payL = diff.paymentLlm ?? null;
            if (payR === payL) paymentAgree += 1;
            else paymentDisagree += 1;

            const plan = buildBootstrapSegmentPlan(c.text, c.extraction);
            if (plan.source === "llm") llmWouldBecomePrimary += 1;
        }
    }

    return {
        cases: cases.length,
        withExtraction,
        equalTerms,
        divergeTerms,
        paymentAgree,
        paymentDisagree,
        llmWouldBecomePrimary,
    };
}
