import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES, requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { buildOrderIdempotencyKey } from "@/lib/orders/buildOrderIdempotencyKey";

export const runtime = "nodejs";

const PDV_FINALIZE_RATE_LIMIT = 30;
const PDV_FINALIZE_RATE_WINDOW_MS = 60_000;

const PRAZO_METHODS = new Set(["credit", "boleto", "cheque", "promissoria"]);

function isPrazo(method: string): boolean {
    return PRAZO_METHODS.has(String(method).toLowerCase());
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const rl = checkRateLimit(
        `pdv_finalize:${companyId}`,
        PDV_FINALIZE_RATE_LIMIT,
        PDV_FINALIZE_RATE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const body = (await req.json().catch(() => ({}))) as {
        cash_register_id?: string;
        seller_name?: string | null;
        customer_id?: string | null;
        customer_name?: string | null;
        auto_print?: boolean;
        cart?: Array<{
            variant_id: string;
            produto_id: string;
            product_name: string;
            details?: string | null;
            unit_price: number;
            qty: number;
            sigla_comercial?: string | null;
        }>;
        payments?: Array<{ method: string; value: number; due_date?: string | null }>;
        active_order_id?: string | null;
        active_order_source?: string | null;
    };

    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const payments = Array.isArray(body.payments) ? body.payments : [];

    if (!cashRegisterId) return NextResponse.json({ error: "cash_register_required" }, { status: 400 });
    if (cart.length === 0) return NextResponse.json({ error: "cart_empty" }, { status: 400 });

    const cartTotal = cart.reduce((s, i) => s + Number(i.unit_price ?? 0) * Number(i.qty ?? 0), 0);
    const payTotal = payments.reduce((s, p) => s + (Number(p.value) || 0), 0);
    if (payTotal < cartTotal) return NextResponse.json({ error: "payments_insufficient" }, { status: 400 });

    const hasCreditPayment = payments.some((p) => isPrazo(p.method));
    if (hasCreditPayment && !String(body.customer_id ?? "").trim()) {
        return NextResponse.json({ error: "customer_required_for_prazo" }, { status: 400 });
    }
    if (hasCreditPayment) {
        const prazoFeat = await requirePlanFeature(admin, companyId, "pdv");
        if (!prazoFeat.ok) return prazoFeat.response;
    }

    const wantsPrint = body.auto_print === true;
    if (wantsPrint) {
        const printFeat = await requirePlanFeature(admin, companyId, "printing_auto");
        if (!printFeat.ok) return printFeat.response;
    }

    const { data: cr, error: crErr } = await admin
        .from("cash_registers")
        .select("id")
        .eq("id", cashRegisterId)
        .eq("company_id", companyId)
        .eq("status", "open")
        .maybeSingle();
    if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 });
    if (!cr) return NextResponse.json({ error: "cash_register_invalid" }, { status: 400 });

    // Chave determinística: retry de rede ou double-click no botão "Finalizar"
    // com o mesmo caixa/carrinho/pagamentos não duplica venda (a RPC trata
    // via `sales.idempotency_key`, ver 20260811110000_pdv_finalize_idempotency_key.sql).
    const idempotencyKey = buildOrderIdempotencyKey({
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
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

    const row = rpcOut as { sale_id?: string; order_id?: string } | null;
    const saleId = row?.sale_id;
    const oid    = row?.order_id;
    if (!saleId || !oid) return NextResponse.json({ error: "finalize_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, sale_id: saleId, order_id: oid });
}
