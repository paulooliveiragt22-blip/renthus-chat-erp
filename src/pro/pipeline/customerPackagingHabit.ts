/**
 * Hábito de embalagem (UN vs CX) por produto, a partir do histórico de pedidos do cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PackagingHabit = "UN" | "CX";

function packFromUnitType(unitType: string | null | undefined): PackagingHabit | null {
    const u = String(unitType ?? "")
        .toLowerCase()
        .trim();
    if (u === "case" || u === "cx" || u === "caixa") return "CX";
    if (u === "unit" || u === "un" || u === "unidade") return "UN";
    return null;
}

function packFromSigla(sigla: string | null | undefined): PackagingHabit | null {
    const s = String(sigla ?? "").toUpperCase();
    if (!s) return null;
    if (/\bCX\b|FARD|PAC/u.test(s) || s.includes("CX")) return "CX";
    if (s === "UN" || /\bUN\b/u.test(s)) return "UN";
    return null;
}

/**
 * Para cada product_id, hábito dominante se ≥2 compras e margem clara (2×).
 */
export async function loadCustomerPackagingHabits(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string;
    productIds: string[];
    limit?: number;
}): Promise<Map<string, PackagingHabit>> {
    const out = new Map<string, PackagingHabit>();
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
        console.warn("[customerPackagingHabit] orders", ordErr.message);
        return out;
    }
    const orderIds = (orders ?? []).map((o) => String((o as { id: string }).id));
    if (!orderIds.length) return out;

    const { data: items, error: itemErr } = await params.admin
        .from("order_items")
        .select("product_id, unit_type, produto_embalagem_id")
        .eq("company_id", params.companyId)
        .in("order_id", orderIds)
        .in("product_id", ids)
        .limit(limit);

    if (itemErr) {
        console.warn("[customerPackagingHabit] items", itemErr.message);
        return out;
    }

    type Row = {
        product_id?: string | null;
        unit_type?: string | null;
        produto_embalagem_id?: string | null;
    };

    const counts = new Map<string, { un: number; cx: number }>();
    const needEmb = new Map<string, string>(); // embalagemId → product_id

    for (const raw of (items ?? []) as Row[]) {
        const pid = String(raw.product_id ?? "").trim();
        if (!pid) continue;
        const pack = packFromUnitType(raw.unit_type);
        if (pack) {
            const c = counts.get(pid) ?? { un: 0, cx: 0 };
            if (pack === "UN") c.un += 1;
            else c.cx += 1;
            counts.set(pid, c);
        } else if (raw.produto_embalagem_id) {
            needEmb.set(String(raw.produto_embalagem_id), pid);
        }
    }

    if (needEmb.size) {
        const { data: embRows } = await params.admin
            .from("view_chat_produtos")
            .select("id, sigla_comercial")
            .eq("company_id", params.companyId)
            .in("id", [...needEmb.keys()]);
        for (const e of embRows ?? []) {
            const embId = String((e as { id?: string }).id ?? "");
            const pid = needEmb.get(embId);
            const pack = packFromSigla((e as { sigla_comercial?: string }).sigla_comercial);
            if (!pid || !pack) continue;
            const c = counts.get(pid) ?? { un: 0, cx: 0 };
            if (pack === "UN") c.un += 1;
            else c.cx += 1;
            counts.set(pid, c);
        }
    }

    for (const [pid, c] of counts) {
        const total = c.un + c.cx;
        if (total < 2) continue;
        if (c.un >= 2 && c.un >= c.cx * 2) out.set(pid, "UN");
        else if (c.cx >= 2 && c.cx >= c.un * 2) out.set(pid, "CX");
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
