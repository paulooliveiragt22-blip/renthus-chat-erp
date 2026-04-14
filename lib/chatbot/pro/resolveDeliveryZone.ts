import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryZoneRow = { id: string; label: string; fee: number; neighborhoods?: string[] | null };

/**
 * Igual à lógica do Flow de catálogo: compara bairro digitado com label e lista neighborhoods.
 */
export async function lookupDeliveryZone(
    admin: SupabaseClient,
    companyId: string,
    bairroRaw: string
): Promise<DeliveryZoneRow | null> {
    const bairro = bairroRaw.trim();
    if (!bairro) return null;

    const { data: zones } = await admin
        .from("delivery_zones")
        .select("id, label, fee, neighborhoods")
        .eq("company_id", companyId)
        .eq("is_active", true);

    const nb = bairro.toLowerCase();
    const row = (zones ?? []).find((z) => {
        const label = String(z.label ?? "").toLowerCase();
        if (label.includes(nb) || nb.includes(label)) return true;
        if (Array.isArray(z.neighborhoods))
            return z.neighborhoods.some((n: string) => {
                const nn = n.toLowerCase();
                return nn.includes(nb) || nb.includes(nn);
            });
        return false;
    });

    if (!row) return null;
    return {
        id:            row.id as string,
        label:         String(row.label ?? ""),
        fee:           Number(row.fee ?? 0),
        neighborhoods: row.neighborhoods as string[] | null,
    };
}
