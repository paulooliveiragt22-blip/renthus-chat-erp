import type { SupabaseClient } from "@supabase/supabase-js";
import { createLlmPort } from "@/src/pro/adapters/llm/createLlmPort";
import { extractOrderLinesStructured } from "@/src/pro/services/extraction/structuredOrderExtract";
import { parseMultiItemOrderSegments } from "@/src/pro/pipeline/parseMultiItemOrderSegments";
import { inferPaymentMethodFromText } from "@/src/pro/pipeline/inferPaymentFromText";
import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";

export function isStructuredExtractShadowEnabled(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const v = env.PRO_STRUCTURED_EXTRACT_SHADOW?.trim().toLowerCase() ?? "";
    return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type ExtractionShadowDiff = {
    equalTerms: boolean;
    regexSegments: string[];
    llmTerms: string[];
    missingInLlm: string[];
    extraInLlm: string[];
    paymentRegex: string | null;
    paymentLlm: string | null | undefined;
};

function norm(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

export function diffExtractionVsRegexBootstrap(
    userText: string,
    extraction: OrderLineExtraction | null
): ExtractionShadowDiff {
    const regexSegments = parseMultiItemOrderSegments(userText);
    const llmTerms = (extraction?.items ?? []).map((i) => i.searchTerm);
    const rSet = new Set(regexSegments.map(norm));
    const lSet = new Set(llmTerms.map(norm));
    const missingInLlm = [...rSet].filter((t) => !lSet.has(t));
    const extraInLlm = [...lSet].filter((t) => !rSet.has(t));
    return {
        equalTerms: missingInLlm.length === 0 && extraInLlm.length === 0 && rSet.size > 0,
        regexSegments,
        llmTerms,
        missingInLlm,
        extraInLlm,
        paymentRegex: inferPaymentMethodFromText(userText),
        paymentLlm: extraction?.paymentMethod,
    };
}

/**
 * Best-effort sombra: não altera o turno. Liga com PRO_STRUCTURED_EXTRACT_SHADOW=1.
 */
export function scheduleStructuredExtractShadow(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    inboundMessageId: string;
    userText: string;
}): void {
    if (!isStructuredExtractShadowEnabled()) return;
    const { admin, companyId, threadId, inboundMessageId, userText } = params;
    void (async () => {
        try {
            const llm = createLlmPort(admin);
            const extraction = await extractOrderLinesStructured({
                llm,
                userText,
                companyId,
            });
            const diff = diffExtractionVsRegexBootstrap(userText, extraction);
            console.info("[structured_extract.shadow]", {
                companyId,
                threadId,
                inboundMessageId,
                equalTerms: diff.equalTerms,
                regexSegments: diff.regexSegments,
                llmTerms: diff.llmTerms,
                missingInLlm: diff.missingInLlm,
                extraInLlm: diff.extraInLlm,
                paymentRegex: diff.paymentRegex,
                paymentLlm: diff.paymentLlm,
            });
        } catch (e) {
            console.warn(
                "[structured_extract.shadow] error:",
                e instanceof Error ? e.message : e
            );
        }
    })();
}
