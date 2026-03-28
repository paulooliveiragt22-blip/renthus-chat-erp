/**
 * lib/chatbot/db/variants.ts
 *
 * Funções de acesso ao catálogo no Supabase.
 * Na arquitetura Flow-First, o catálogo é gerenciado pelo flows/route.ts.
 * Este módulo mantém apenas utilitários de leitura usados pelo FAQ e flows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../types";

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
    const { data } = await admin
        .from("delivery_zones")
        .select("id, label, fee")
        .eq("company_id", companyId)
        .ilike("label", `%${neighborhood}%`)
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return { id: data.id as string, label: data.label as string, fee: Number(data.fee ?? 0) };
}
