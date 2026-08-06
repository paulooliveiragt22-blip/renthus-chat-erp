import { parseMultiItemOrderSegments } from "@/src/pro/pipeline/parseMultiItemOrderSegments";
import {
    inferPaymentMethodFromText,
    inferUseSavedAddressFromText,
} from "@/src/pro/pipeline/inferPaymentFromText";
import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";
import type { PaymentMethod } from "@/src/types/contracts";

export type BootstrapSegmentPlan = {
    segments: string[];
    /** quantity por termo normalizado (sem acento). */
    qtyByTerm: Record<string, number>;
    payment: PaymentMethod | null;
    useSavedAddress: boolean;
    source: "llm" | "regex";
};

function norm(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

export function isStructuredExtractPrimaryEnabled(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const v = env.PRO_STRUCTURED_EXTRACT_PRIMARY?.trim().toLowerCase() ?? "";
    return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Monta segmentos de bootstrap: LLM (se válido) senão regex.
 * Quantidades do LLM entram em qtyByTerm; regex assume 1.
 */
export function buildBootstrapSegmentPlan(
    userText: string,
    extraction: OrderLineExtraction | null | undefined
): BootstrapSegmentPlan {
    const regexSegments = parseMultiItemOrderSegments(userText);
    const paymentRegex = inferPaymentMethodFromText(userText);
    const useSavedRegex = inferUseSavedAddressFromText(userText);

    if (extraction && extraction.items.length > 0) {
        const qtyByTerm: Record<string, number> = {};
        const segments: string[] = [];
        for (const it of extraction.items) {
            const term = it.searchTerm.trim();
            if (!term) continue;
            const key = norm(term);
            qtyByTerm[key] = (qtyByTerm[key] ?? 0) + Number(it.quantity || 1);
            if (!segments.some((s) => norm(s) === key)) segments.push(term);
        }
        if (segments.length > 0) {
            return {
                segments,
                qtyByTerm,
                payment: extraction.paymentMethod ?? paymentRegex,
                useSavedAddress: extraction.useSavedAddress === true || useSavedRegex,
                source: "llm",
            };
        }
    }

    const qtyByTerm: Record<string, number> = {};
    for (const s of regexSegments) qtyByTerm[norm(s)] = 1;
    return {
        segments: regexSegments,
        qtyByTerm,
        payment: paymentRegex,
        useSavedAddress: useSavedRegex,
        source: "regex",
    };
}
