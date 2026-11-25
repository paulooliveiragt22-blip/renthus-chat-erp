import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStorePaymentPolicy } from "@/lib/payments/loadStorePaymentPolicy";
import { assertStorePaymentAllowed } from "@/src/financeiro/domain/storePaymentPolicy";
import { isMesaPaymentMethod } from "@/src/mesa/domain/paymentParts";

type PartLine = { item_id?: string; qty?: number };
type PartBody = { amount?: number; method?: string; lines?: PartLine[] };

export type NormalizedMesaPart =
    | { method: string; amount: number }
    | { method: string; lines: Array<{ item_id: string; qty: number }> };

export async function normalizeMesaReleaseParts(
    admin: SupabaseClient,
    companyId: string,
    raw: unknown,
): Promise<{ ok: true; parts: NormalizedMesaPart[] } | { ok: false; error: string }> {
    const parts = Array.isArray(raw) ? (raw as PartBody[]) : [];
    if (parts.length === 0) return { ok: false, error: "payments_required" };

    const policy = await loadStorePaymentPolicy(admin, companyId);
    const normalized: NormalizedMesaPart[] = [];
    for (const part of parts) {
        const pay = assertStorePaymentAllowed(policy.immediate, policy.prazo, part.method ?? "");
        if (!pay.ok || !isMesaPaymentMethod(pay.method)) return { ok: false, error: "payment_not_allowed" };
        if (Array.isArray(part.lines)) {
            const lines = [];
            for (const line of part.lines) {
                const qty = Number(line.qty);
                const itemId = typeof line.item_id === "string" ? line.item_id.trim() : "";
                if (!itemId || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: "qty_mismatch" };
                lines.push({ item_id: itemId, qty });
            }
            if (lines.length === 0) return { ok: false, error: "qty_mismatch" };
            normalized.push({ method: pay.method, lines });
            continue;
        }
        const amount = Number(part.amount);
        if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "payment_amount_invalid" };
        normalized.push({ amount, method: pay.method });
    }
    return { ok: true, parts: normalized };
}
