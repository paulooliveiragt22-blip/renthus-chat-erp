/**
 * Plano de segmentos do bootstrap — somente a partir da extração LLM.
 */

import type { OrderLineExtraction, CheckoutSwapIntent } from "@/src/domain/contracts/orderExtraction";
import type { PaymentMethod } from "@/src/types/contracts";
import { looksLikePackagingOnlyHint } from "./packagingHint";

export type BootstrapSegmentPlan = {
    segments: string[];
    /** quantity por termo normalizado (sem acento). */
    qtyByTerm: Record<string, number>;
    payment: PaymentMethod | null;
    useSavedAddress: boolean;
    source: "llm";
};

function norm(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Monta segmentos/qty a partir da extração. Null se não houver itens. */
export function buildBootstrapSegmentPlanFromExtraction(
    extraction: OrderLineExtraction | null | undefined
): BootstrapSegmentPlan | null {
    if (!extraction?.items?.length) return null;

    const qtyByTerm: Record<string, number> = {};
    const segments: string[] = [];
    for (const it of extraction.items) {
        const term = it.searchTerm.trim();
        if (!term) continue;
        const key = norm(term);
        qtyByTerm[key] = (qtyByTerm[key] ?? 0) + Number(it.quantity || 1);
        if (!segments.some((s) => norm(s) === key)) segments.push(term);
    }
    if (!segments.length) return null;

    return {
        segments,
        qtyByTerm,
        payment: extraction.paymentMethod ?? null,
        useSavedAddress: extraction.useSavedAddress === true,
        source: "llm",
    };
}

/** Troca/substitui a partir da extração (sem regex de linguagem). */
export function swapIntentFromExtraction(
    extraction: OrderLineExtraction | null | undefined
): CheckoutSwapIntent | null {
    const s = extraction?.swap;
    if (!s?.removeName?.trim() || !s?.replaceSearchTerm?.trim()) return null;

    const removeName = s.removeName.trim();
    const replaceHint = (s.replaceHint ?? s.replaceSearchTerm).trim();
    const replaceSearchTerm = s.replaceSearchTerm.trim();

    const searchQuery = looksLikePackagingOnlyHint(replaceHint)
        ? `${removeName} ${replaceHint}`.replaceAll(/\s+/g, " ").trim()
        : replaceSearchTerm.includes(removeName.split(/\s+/)[0] ?? "")
          ? replaceSearchTerm
          : `${removeName} ${replaceSearchTerm}`.replaceAll(/\s+/g, " ").trim();

    return { removeName, searchQuery, replaceHint };
}

/** @deprecated Use buildBootstrapSegmentPlanFromExtraction */
export function buildBootstrapSegmentPlan(
    _userText: string,
    extraction: OrderLineExtraction | null | undefined
): BootstrapSegmentPlan | null {
    return buildBootstrapSegmentPlanFromExtraction(extraction);
}
