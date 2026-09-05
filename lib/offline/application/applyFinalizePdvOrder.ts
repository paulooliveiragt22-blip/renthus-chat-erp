import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderIdempotencyKey } from "@/lib/orders/buildOrderIdempotencyKey";
import { canFulfillQty } from "@/lib/products/stockPolicy";

const PRAZO_METHODS = new Set(["credit", "boleto", "cheque", "promissoria"]);

export type FinalizePdvPayload = {
    cash_register_id: string;
    seller_name?: string | null;
    customer_id?: string | null;
    customer_name?: string | null;
    auto_print?: boolean;
    cart: Array<{
        variant_id: string;
        produto_id: string;
        product_name: string;
        details?: string | null;
        unit_price: number;
        qty: number;
        sigla_comercial?: string | null;
    }>;
    payments: Array<{ method: string; value: number; due_date?: string | null }>;
    active_order_id?: string | null;
    active_order_source?: string | null;
    /** Offline: UUID do outbox — vira sales.idempotency_key (P1.4). */
    client_mutation_id?: string | null;
};

export type ApplyFinalizeResult =
    | { ok: true; sale_id: string; order_id: string; alreadyDone?: boolean }
    | { ok: false; error: string; conflict?: boolean };

/**
 * Aplica finalize PDV (online route + offline sync). D-P2 via stockPolicy.
 */
export async function applyFinalizePdvOrder(args: {
    admin: SupabaseClient;
    companyId: string;
    body: FinalizePdvPayload;
    /** Se true, valida estoque com vender_com_estoque_zero antes da RPC. */
    enforceStockPolicy?: boolean;
}): Promise<ApplyFinalizeResult> {
    const { admin, companyId, body } = args;
    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    if (!cashRegisterId) return { ok: false, error: "cash_register_required" };
    if (cart.length === 0) return { ok: false, error: "cart_empty" };

    const cartTotal = cart.reduce((s, i) => s + Number(i.unit_price ?? 0) * Number(i.qty ?? 0), 0);
    const payTotal = payments.reduce((s, p) => s + (Number(p.value) || 0), 0);
    if (payTotal < cartTotal) return { ok: false, error: "payments_insufficient" };

    const hasCreditPayment = payments.some((p) => PRAZO_METHODS.has(String(p.method).toLowerCase()));
    if (hasCreditPayment && !String(body.customer_id ?? "").trim()) {
        return { ok: false, error: "customer_required_for_prazo" };
    }

    const { data: cr, error: crErr } = await admin
        .from("cash_registers")
        .select("id")
        .eq("id", cashRegisterId)
        .eq("company_id", companyId)
        .eq("status", "open")
        .maybeSingle();
    if (crErr) return { ok: false, error: crErr.message };
    if (!cr) return { ok: false, error: "cash_register_invalid" };

    const { loadStorePaymentPolicy } = await import("@/lib/payments/loadStorePaymentPolicy");
    const { assertStorePaymentAllowed } = await import("@/src/financeiro/domain/storePaymentPolicy");
    const storePolicy = await loadStorePaymentPolicy(admin, companyId);

    for (const p of payments) {
        const allowed = assertStorePaymentAllowed(
            storePolicy.immediate,
            storePolicy.prazo,
            p.method
        );
        if (!allowed.ok) {
            return { ok: false, error: allowed.error };
        }
    }

    if (args.enforceStockPolicy !== false) {
        const stockCheck = await assertCartStockPolicy(admin, companyId, cart);
        if (!stockCheck.ok) {
            return { ok: false, error: stockCheck.error, conflict: true };
        }
    }

    const clientMutationId = String(body.client_mutation_id ?? "").trim();
    const idempotencyKey =
        clientMutationId ||
        buildOrderIdempotencyKey({
            source: "pdv",
            scopeId: `${cashRegisterId}:${body.active_order_id ?? "novo"}`,
            items: cart.map((i) => ({
                produtoEmbalagemId: i.variant_id,
                quantity: i.qty,
                unitPrice: i.unit_price,
            })),
            grandTotal: payTotal,
            paymentMethod: payments.map((p) => `${p.method}:${p.value}`).join(","),
        });

    const p_payload = {
        cash_register_id: cashRegisterId,
        seller_name: body.seller_name ?? null,
        customer_id: body.customer_id ?? null,
        customer_name: body.customer_name ?? null,
        auto_print: body.auto_print === true,
        cart: cart.map((i) => ({
            variant_id: i.variant_id,
            produto_id: i.produto_id,
            product_name: i.product_name,
            details: i.details ?? null,
            unit_price: i.unit_price,
            qty: i.qty,
            sigla_comercial: i.sigla_comercial ?? null,
        })),
        payments: payments.map((p) => ({
            method: p.method,
            value: p.value,
            due_date: p.due_date ?? null,
        })),
        active_order_id: body.active_order_id ?? null,
        active_order_source: body.active_order_source ?? null,
        idempotency_key: idempotencyKey,
    };

    const { data: rpcOut, error: rpcErr } = await admin.rpc("rpc_finalize_pdv_order", {
        p_company_id: companyId,
        p_payload,
    });
    if (rpcErr) return { ok: false, error: rpcErr.message };

    const row = rpcOut as { sale_id?: string; order_id?: string } | null;
    const saleId = row?.sale_id;
    const oid = row?.order_id;
    if (!saleId || !oid) return { ok: false, error: "finalize_failed" };

    return { ok: true, sale_id: saleId, order_id: oid };
}

async function assertCartStockPolicy(
    admin: SupabaseClient,
    companyId: string,
    cart: FinalizePdvPayload["cart"]
): Promise<{ ok: true } | { ok: false; error: string }> {
    const productIds = [...new Set(cart.map((c) => c.produto_id).filter(Boolean))];
    if (productIds.length === 0) return { ok: true };

    const { data: products, error } = await admin
        .from("products")
        .select("id, estoque_atual, vender_com_estoque_zero")
        .eq("company_id", companyId)
        .in("id", productIds);
    if (error) return { ok: false, error: error.message };

    const byId = new Map(
        (products ?? []).map((p) => [
            String((p as { id: string }).id),
            p as {
                id: string;
                estoque_atual: number | null;
                vender_com_estoque_zero: boolean | null;
            },
        ])
    );

    const variantIds = [...new Set(cart.map((c) => c.variant_id).filter(Boolean))];
    const { data: embRows, error: embErr } = await admin
        .from("produto_embalagens")
        .select("id, fator_conversao")
        .eq("company_id", companyId)
        .in("id", variantIds);
    if (embErr) return { ok: false, error: embErr.message };
    const fatorByEmb = new Map(
        (embRows ?? []).map((e) => [
            String((e as { id: string }).id),
            Math.max(1, Number((e as { fator_conversao?: number }).fator_conversao ?? 1)),
        ])
    );

    const needByProduct = new Map<string, { need: number; flag: boolean | null | undefined; name: string }>();

    for (const line of cart) {
        const fator = fatorByEmb.get(line.variant_id) ?? 1;
        const prod = byId.get(line.produto_id);
        const flag = prod?.vender_com_estoque_zero;
        const prev = needByProduct.get(line.produto_id);
        const add = Number(line.qty) * fator;
        needByProduct.set(line.produto_id, {
            need: (prev?.need ?? 0) + add,
            flag: flag,
            name: line.product_name,
        });
    }

    for (const [productId, agg] of needByProduct) {
        const prod = byId.get(productId);
        const estoque = Number(prod?.estoque_atual ?? 0);
        const ok = canFulfillQty({
            venderComEstoqueZero: agg.flag,
            estoqueUnidades: estoque,
            fatorConversao: 1,
            qty: agg.need,
        });
        if (!ok) {
            return {
                ok: false,
                error: `stock_insufficient:${agg.name}`,
            };
        }
    }

    return { ok: true };
}
