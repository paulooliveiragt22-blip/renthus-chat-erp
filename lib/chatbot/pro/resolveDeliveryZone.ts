import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";

export type DeliveryZoneRow = { id: string; label: string; fee: number; neighborhoods?: string[] | null };

/**
 * Igual à lógica do Flow de catálogo: compara bairro digitado com label e lista neighborhoods.
 */
export async function lookupDeliveryZone(
    admin: SupabaseClient,
    companyId: string,
    bairroRaw: string
): Promise<DeliveryZoneRow | null> {
    const r = await resolveDeliveryForNeighborhood(admin, companyId, bairroRaw);
    if (!r.served) return null;
    return { id: r.matched_rule_id ?? `city-wide:${companyId}`, label: r.label, fee: r.fee, neighborhoods: null };
}
