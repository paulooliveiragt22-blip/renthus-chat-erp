/**
 * lib/chatbot/db/variants.ts
 *
 * Funções de acesso ao catálogo no Supabase.
 * Na arquitetura Flow-First, o catálogo é gerenciado pelo flows/route.ts.
 * Este módulo mantém apenas utilitários de leitura usados pelo FAQ e flows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../types";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";

// ─── Categorias ───────────────────────────────────────────────────────────────

export async function getCategories(
    admin: SupabaseClient,
    companyId: string
): Promise<Category[]> {
    const { data } = await admin
        .from("view_categories")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");

    return (data as Category[]) ?? [];
}

// ─── Zona de entrega ──────────────────────────────────────────────────────────

export async function findDeliveryZone(
    admin: SupabaseClient,
    companyId: string,
    neighborhood: string
): Promise<{ id: string; label: string; fee: number } | null> {
    const r = await resolveDeliveryForNeighborhood(admin, companyId, neighborhood);
    if (!r.served) return null;
    return { id: r.matched_rule_id ?? `city-wide:${companyId}`, label: r.label, fee: r.fee };
}
