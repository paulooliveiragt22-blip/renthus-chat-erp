/**
 * FAQ de cobertura de entrega — resposta determinística (não depende do LLM).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";

const COVERAGE_RE =
    /(?:voc[eê]s?\s+)?(?:entregam?|fazem?\s+entrega|atendem?)\s+(?:no|na|em)\s+(.+?)\s*\??\s*$/iu;

/** Extrai bairro de frases tipo "vocês entregam no Centro?". */
export function extractNeighborhoodFromDeliveryFaq(text: string): string | null {
    const raw = text.trim();
    if (!raw) return null;
    const m = raw.match(COVERAGE_RE);
    if (!m?.[1]) return null;
    let neighborhood = m[1]
        .trim()
        .replace(/[?.!]+$/u, "")
        .trim();
    /** Remove cidade colada: "Centro, Sorriso" → Centro */
    neighborhood = neighborhood.split(",")[0]?.trim() ?? neighborhood;
    if (neighborhood.length < 2 || neighborhood.length > 80) return null;
    return neighborhood;
}

export function looksLikeDeliveryCoverageQuestion(text: string): boolean {
    return extractNeighborhoodFromDeliveryFaq(text) != null;
}

export function buildDeliveryCoverageReply(params: {
    neighborhood: string;
    served: boolean;
    serviceByZone: boolean;
    serviceCity: string | null;
}): string {
    const bairro = params.neighborhood.trim();
    const city = (params.serviceCity ?? "").trim();
    const cityBit = city ? ` de *${city}*` : "";

    if (!params.serviceByZone) {
        return (
            `Sim! Entregamos em toda a cidade${cityBit}. ` +
            `Pode me dizer o que deseja pedir 😊`
        );
    }

    if (params.served) {
        return (
            `Sim! Entregamos em *${bairro}* sim` +
            (city ? ` (${city})` : "") +
            `. Quer fazer um pedido?`
        );
    }

    return (
        `No momento não entregamos em *${bairro}*` +
        (city ? ` (${city})` : "") +
        `. Se tiver outro bairro na área ou preferir outra opção, me avisa.`
    );
}

/**
 * Responde FAQ de cobertura ou `null` se não for o caso / falha de resolução.
 */
export async function tryAnswerDeliveryCoverageFaq(params: {
    admin: SupabaseClient;
    companyId: string;
    userText: string;
}): Promise<string | null> {
    const neighborhood = extractNeighborhoodFromDeliveryFaq(params.userText);
    if (!neighborhood) return null;

    const resolved = await resolveDeliveryForNeighborhood(
        params.admin,
        params.companyId,
        neighborhood
    );

    return buildDeliveryCoverageReply({
        neighborhood: resolved.label || neighborhood,
        served: resolved.served,
        serviceByZone: resolved.service_by_zone,
        serviceCity: resolved.service_city,
    });
}
