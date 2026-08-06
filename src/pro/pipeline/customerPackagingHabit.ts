/**
 * Hábito de *sigla comercial* por produto (histórico do cliente).
 * Fonte canónica: `produto_embalagens.id_sigla_comercial` → `siglas_comerciais.sigla`
 * (exposta em `view_chat_produtos.sigla_comercial`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CompanySigla = {
    id: string;
    sigla: string;
    descricao: string | null;
};

/** Sigla dominante por product_id (ex.: "UN", "CX", "COMBO", "FARD"). */
export type CustomerSiglaHabit = string;

export async function loadCompanySiglas(
    admin: SupabaseClient,
    companyId: string
): Promise<CompanySigla[]> {
    const { data, error } = await admin
        .from("siglas_comerciais")
        .select("id, sigla, descricao")
        .eq("company_id", companyId)
        .order("sigla");
    if (error) {
        console.warn("[companySiglas]", error.message);
        return [];
    }
    return (data ?? [])
        .map((r) => ({
            id: String((r as { id: string }).id),
            sigla: String((r as { sigla?: string }).sigla ?? "")
                .trim()
                .toUpperCase(),
            descricao: String((r as { descricao?: string | null }).descricao ?? "").trim() || null,
        }))
        .filter((r) => r.sigla.length >= 1);
}

/**
 * Para cada product_id, sigla dominante se ≥2 compras e margem clara (2× sobre a 2ª).
 */
export async function loadCustomerSiglaHabits(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string;
    productIds: string[];
    limit?: number;
}): Promise<Map<string, CustomerSiglaHabit>> {
    const out = new Map<string, CustomerSiglaHabit>();
    const ids = [...new Set(params.productIds.map((id) => String(id).trim()).filter(Boolean))];
    if (!ids.length || !params.customerId) return out;

    const limit = Math.min(Math.max(params.limit ?? 60, 10), 150);

    const { data: orders, error: ordErr } = await params.admin
        .from("orders")
        .select("id")
        .eq("company_id", params.companyId)
        .eq("customer_id", params.customerId)
        .in("status", ["finalized", "delivered"])
        .order("created_at", { ascending: false })
        .limit(40);

    if (ordErr) {
        console.warn("[customerSiglaHabit] orders", ordErr.message);
        return out;
    }
    const orderIds = (orders ?? []).map((o) => String((o as { id: string }).id));
    if (!orderIds.length) return out;

    const { data: items, error: itemErr } = await params.admin
        .from("order_items")
        .select("product_id, produto_embalagem_id")
        .eq("company_id", params.companyId)
        .in("order_id", orderIds)
        .in("product_id", ids)
        .limit(limit);

    if (itemErr) {
        console.warn("[customerSiglaHabit] items", itemErr.message);
        return out;
    }

    const embIds = [
        ...new Set(
            (items ?? [])
                .map((r) => String((r as { produto_embalagem_id?: string }).produto_embalagem_id ?? ""))
                .filter(Boolean)
        ),
    ];
    if (!embIds.length) return out;

    const { data: embRows } = await params.admin
        .from("view_chat_produtos")
        .select("id, sigla_comercial")
        .eq("company_id", params.companyId)
        .in("id", embIds);

    const embSigla = new Map<string, string>();
    for (const e of embRows ?? []) {
        const id = String((e as { id?: string }).id ?? "");
        const sigla = String((e as { sigla_comercial?: string }).sigla_comercial ?? "")
            .trim()
            .toUpperCase();
        if (id && sigla) embSigla.set(id, sigla);
    }

    /** product_id → contagem por sigla */
    const counts = new Map<string, Map<string, number>>();
    for (const raw of items ?? []) {
        const pid = String((raw as { product_id?: string }).product_id ?? "").trim();
        const emb = String((raw as { produto_embalagem_id?: string }).produto_embalagem_id ?? "");
        const sigla = embSigla.get(emb);
        if (!pid || !sigla) continue;
        const bySigla = counts.get(pid) ?? new Map<string, number>();
        bySigla.set(sigla, (bySigla.get(sigla) ?? 0) + 1);
        counts.set(pid, bySigla);
    }

    for (const [pid, bySigla] of counts) {
        const ranked = [...bySigla.entries()].sort((a, b) => b[1] - a[1]);
        const top = ranked[0];
        const second = ranked[1];
        if (!top || top[1] < 2) continue;
        if (!second || top[1] >= second[1] * 2) out.set(pid, top[0]);
    }

    return out;
}

export function primaryProductIdFromHits(
    items: Array<{ produto_id?: string | null }>
): string | null {
    const tallies = new Map<string, number>();
    for (const it of items) {
        const id = String(it.produto_id ?? "").trim();
        if (!id) continue;
        tallies.set(id, (tallies.get(id) ?? 0) + 1);
    }
    let best: string | null = null;
    let n = 0;
    for (const [id, c] of tallies) {
        if (c > n) {
            best = id;
            n = c;
        }
    }
    return best;
}

/** @deprecated use loadCustomerSiglaHabits */
export const loadCustomerPackagingHabits = loadCustomerSiglaHabits;
export type PackagingHabit = CustomerSiglaHabit;
