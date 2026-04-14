import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryMode = "all_city" | "allow_list" | "deny_list";

export type DeliveryRule = {
    id: string;
    neighborhood: string;
    is_served: boolean;
    fee_override: number | null;
    min_order_override: number | null;
    eta_override_min: number | null;
    is_active: boolean;
};

export type DeliveryPolicyResolved = {
    served: boolean;
    label: string;
    fee: number;
    min_order: number | null;
    eta_min: number | null;
    mode: DeliveryMode;
    service_city: string | null;
    reason: string | null;
    matched_rule_id: string | null;
};

function normalizeText(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
}

function parseMoney(v: unknown): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function parseNullableMoney(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function parseNullableInt(v: unknown): number | null {
    if (v == null) return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : null;
}

export async function resolveDeliveryForNeighborhood(
    admin: SupabaseClient,
    companyId: string,
    neighborhoodRaw: string
): Promise<DeliveryPolicyResolved> {
    const { data: company } = await admin
        .from("companies")
        .select("cidade, uf, default_delivery_fee, settings")
        .eq("id", companyId)
        .maybeSingle();

    const settings = (company?.settings ?? {}) as Record<string, unknown>;
    const baseFee = parseMoney(company?.default_delivery_fee ?? 0);
    const baseMinOrder = parseNullableMoney(settings.delivery_min_order);
    const baseEta = parseNullableInt(settings.delivery_est_minutes);

    const { data: policy } = await admin
        .from("company_delivery_policy")
        .select("service_city, service_state, service_by_zone, default_mode")
        .eq("company_id", companyId)
        .maybeSingle();

    const mode = (policy?.default_mode as DeliveryMode | null) ?? "all_city";
    const serviceByZone = Boolean(policy?.service_by_zone);
    const serviceCity = (policy?.service_city as string | null) ?? (company?.cidade as string | null) ?? null;
    const serviceState = (policy?.service_state as string | null) ?? (company?.uf as string | null) ?? null;

    const neighborhood = neighborhoodRaw.trim();
    if (!neighborhood) {
        return {
            served: false,
            label: "",
            fee: baseFee,
            min_order: baseMinOrder,
            eta_min: baseEta,
            mode,
            service_city: serviceCity,
            reason: "Bairro não informado.",
            matched_rule_id: null,
        };
    }

    if (!serviceByZone) {
        return {
            served: true,
            label: neighborhood,
            fee: baseFee,
            min_order: baseMinOrder,
            eta_min: baseEta,
            mode,
            service_city: serviceCity,
            reason: null,
            matched_rule_id: null,
        };
    }

    const cityFilter = serviceCity ?? "";
    const { data: rows } = await admin
        .from("company_delivery_neighborhood_rules")
        .select("id, neighborhood, is_served, fee_override, min_order_override, eta_override_min, is_active")
        .eq("company_id", companyId)
        .eq("city", cityFilter)
        .eq("is_active", true);

    const normalizedTarget = normalizeText(neighborhood);
    const rules = (rows ?? []) as Array<Record<string, unknown>>;
    const matched = rules.find((r) => normalizeText(String(r.neighborhood ?? "")) === normalizedTarget) ?? null;

    let served = true;
    if (mode === "allow_list") served = Boolean(matched?.is_served);
    else if (mode === "deny_list") served = matched ? Boolean(matched.is_served) : true;
    else served = matched ? Boolean(matched.is_served) : true;

    const label = matched ? String(matched.neighborhood ?? neighborhood) : neighborhood;
    const fee = matched?.fee_override != null ? parseMoney(matched.fee_override) : baseFee;
    const minOrder = matched?.min_order_override != null ? parseNullableMoney(matched.min_order_override) : baseMinOrder;
    const eta = matched?.eta_override_min != null ? parseNullableInt(matched.eta_override_min) : baseEta;

    return {
        served,
        label,
        fee,
        min_order: minOrder,
        eta_min: eta,
        mode,
        service_city: serviceCity,
        reason: served
            ? null
            : `Bairro "${label}" fora da área de atendimento${serviceCity ? ` em ${serviceCity}` : ""}${serviceState ? `/${serviceState}` : ""}.`,
        matched_rule_id: matched ? String(matched.id ?? "") : null,
    };
}

export function buildDeliveryExpectationText(params: {
    minOrder: number | null;
    etaMin: number | null;
}): string {
    const parts: string[] = [];
    if (params.minOrder != null && Number.isFinite(params.minOrder)) {
        parts.push(`pedido mínimo: R$ ${Number(params.minOrder).toFixed(2).replace(".", ",")}`);
    }
    if (params.etaMin != null && Number.isFinite(params.etaMin)) {
        parts.push(`previsão: ${Math.max(0, Math.floor(params.etaMin))} min`);
    }
    return parts.join(" • ");
}
