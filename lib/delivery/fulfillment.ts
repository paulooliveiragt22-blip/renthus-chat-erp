import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft } from "@/src/types/contracts";

export type FulfillmentType = "delivery" | "pickup";

export type FulfillmentPolicy = {
    deliveriesEnabled: boolean;
    pickupEnabled: boolean;
};

export const DEFAULT_FULFILLMENT_POLICY: FulfillmentPolicy = {
    deliveriesEnabled: true,
    pickupEnabled: true,
};

export function parseFulfillmentType(raw: unknown): FulfillmentType | null {
    const s = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (s === "delivery" || s === "entrega") return "delivery";
    if (s === "pickup" || s === "retirada" || s === "retirar") return "pickup";
    return null;
}

export function loadFulfillmentPolicyFromRow(row: {
    deliveries_enabled?: unknown;
    pickup_enabled?: unknown;
} | null): FulfillmentPolicy {
    if (!row) return { ...DEFAULT_FULFILLMENT_POLICY };
    return {
        deliveriesEnabled: row.deliveries_enabled !== false,
        pickupEnabled: row.pickup_enabled !== false,
    };
}

export async function loadFulfillmentPolicy(
    admin: SupabaseClient,
    companyId: string
): Promise<FulfillmentPolicy> {
    const { data } = await admin
        .from("company_delivery_policy")
        .select("deliveries_enabled, pickup_enabled")
        .eq("company_id", companyId)
        .maybeSingle();
    return loadFulfillmentPolicyFromRow(data);
}

export function assertFulfillmentAllowed(
    policy: FulfillmentPolicy,
    type: FulfillmentType
): { ok: true } | { ok: false; error: "delivery_disabled" | "pickup_disabled" } {
    if (type === "delivery" && !policy.deliveriesEnabled) {
        return { ok: false, error: "delivery_disabled" };
    }
    if (type === "pickup" && !policy.pickupEnabled) {
        return { ok: false, error: "pickup_disabled" };
    }
    return { ok: true };
}

export function resolveSoleFulfillmentType(policy: FulfillmentPolicy): FulfillmentType | null {
    if (policy.deliveriesEnabled && !policy.pickupEnabled) return "delivery";
    if (!policy.deliveriesEnabled && policy.pickupEnabled) return "pickup";
    return null;
}

export function needsFulfillmentChoice(
    policy: FulfillmentPolicy,
    current: FulfillmentType | null | undefined
): boolean {
    if (current === "delivery" || current === "pickup") return false;
    return policy.deliveriesEnabled && policy.pickupEnabled;
}

export function isFulfillmentUnavailable(policy: FulfillmentPolicy): boolean {
    return !policy.deliveriesEnabled && !policy.pickupEnabled;
}

/** Passo seguinte no cardápio após carrinho/identificação. */
export type MenuCheckoutFulfillmentStep = "fulfillment" | "address" | "payment" | "unavailable";

export function nextMenuCheckoutStep(policy: FulfillmentPolicy): MenuCheckoutFulfillmentStep {
    if (isFulfillmentUnavailable(policy)) return "unavailable";
    if (policy.deliveriesEnabled && policy.pickupEnabled) return "fulfillment";
    if (policy.pickupEnabled && !policy.deliveriesEnabled) return "payment";
    return "address";
}

/**
 * Aplica o modo único da loja (só entrega ou só retirada). Não infere a partir de endereço —
 * isso fica no checkout do bot para não misturar domínio de endereço aqui.
 */
export function applyFulfillmentPolicyToDraft(
    draft: OrderDraft,
    policy: FulfillmentPolicy
): OrderDraft {
    if (draft.fulfillmentType === "pickup") return applyPickupTotals(draft);
    if (draft.fulfillmentType === "delivery") return { ...draft, fulfillmentType: "delivery" };
    const sole = resolveSoleFulfillmentType(policy);
    if (sole === "pickup") return applyPickupTotals({ ...draft, fulfillmentType: "pickup" });
    if (sole === "delivery") return { ...draft, fulfillmentType: "delivery" };
    return draft;
}

export function isPickupDraft(draft: OrderDraft | null | undefined): boolean {
    return draft?.fulfillmentType === "pickup";
}

/** Recalcula totais de retirada: taxa 0, sem mínimo de entrega. */
export function applyPickupTotals(draft: OrderDraft): OrderDraft {
    const totalItems = draft.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    return {
        ...draft,
        fulfillmentType: "pickup",
        deliveryFee: 0,
        deliveryMinOrder: null,
        deliveryZoneId: null,
        deliveryEtaMin: null,
        deliveryAddressText: draft.deliveryAddressText?.trim() || "Retirada no local",
        grandTotal: Number(totalItems.toFixed(2)),
        totalItems: Number(totalItems.toFixed(2)),
    };
}

export function withFulfillmentPreserved(
    previous: OrderDraft | null | undefined,
    next: OrderDraft | null
): OrderDraft | null {
    if (!next) return next;
    const ft = next.fulfillmentType ?? previous?.fulfillmentType ?? null;
    if (ft === "pickup") return applyPickupTotals({ ...next, fulfillmentType: "pickup" });
    return { ...next, fulfillmentType: ft };
}
