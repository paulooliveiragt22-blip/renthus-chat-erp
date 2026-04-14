import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type PayMethod = "pix" | "card" | "debit" | "cash" | "credit" | "boleto" | "cheque" | "promissoria";

const PRAZO_METHODS = new Set<PayMethod>(["credit", "boleto", "cheque", "promissoria"]);

function normMethod(m: string): string {
    if (m === "credit") return "credit_installment";
    return m;
}

function isPrazo(method: string): boolean {
    return PRAZO_METHODS.has(method as PayMethod);
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

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

    const { data: cr, error: crErr } = await admin
        .from("cash_registers")
        .select("id")
        .eq("id", cashRegisterId)
        .eq("company_id", companyId)
        .eq("status", "open")
        .maybeSingle();
    if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 });
    if (!cr) return NextResponse.json({ error: "cash_register_invalid" }, { status: 400 });

    const sellerName = String(body.seller_name ?? "").trim();
    const customerId = String(body.customer_id ?? "").trim() || null;
    const activeOrderId = body.active_order_id ? String(body.active_order_id).trim() : null;
    const activeOrderSource = body.active_order_source != null ? String(body.active_order_source) : null;

    const primary = [...payments].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))[0];
    const isPaid = !hasCreditPayment;

    const src = activeOrderId ? activeOrderSource : null;
    const saleOrigin =
        !src || src === "pdv_direct"
            ? "pdv"
            : src === "chatbot" || src.startsWith("flow_")
              ? "chatbot"
              : src === "ui"
                ? "ui_order"
                : "pdv";
    const finEntryOrigin = saleOrigin === "chatbot" ? "chatbot" : saleOrigin === "ui_order" ? "ui_order" : "balcao";

    const { data: sale, error: saleErr } = await admin
        .from("sales")
        .insert({
            company_id: companyId,
            cash_register_id: cashRegisterId,
            customer_id: customerId,
            seller_name: sellerName || null,
            origin: saleOrigin,
            subtotal: cartTotal,
            total: cartTotal,
            status: isPaid ? "paid" : "partial",
            notes: sellerName ? `Balcão — ${sellerName}` : "Balcão",
            ...(activeOrderId ? { order_id: activeOrderId } : {}),
        })
        .select("id")
        .single();
    if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 });
    const saleId = sale.id as string;

    const { error: saleItemErr } = await admin.from("sale_items").insert(
        cart.map((i) => ({
            sale_id: saleId,
            company_id: companyId,
            produto_embalagem_id: i.variant_id,
            product_name: `${i.product_name}${i.details ? ` ${i.details}` : ""}`,
            qty: i.qty,
            unit_price: i.unit_price,
            unit_cost: 0,
        }))
    );
    if (saleItemErr) return NextResponse.json({ error: saleItemErr.message }, { status: 500 });

    const { error: salePayErr } = await admin.from("sale_payments").insert(
        payments.map((p) => ({
            sale_id: saleId,
            company_id: companyId,
            payment_method: normMethod(p.method),
            amount: Number(p.value) || 0,
            due_date: p.due_date ? new Date(`${p.due_date}T12:00:00`).toISOString() : null,
            received_at: !isPrazo(p.method) ? new Date().toISOString() : null,
        }))
    );
    if (salePayErr) return NextResponse.json({ error: salePayErr.message }, { status: 500 });

    let oid: string;
    if (activeOrderId) {
        const patch: Record<string, unknown> = {
            sale_id: saleId,
            status: "finalized",
            confirmation_status: "confirmed",
            confirmed_at: new Date().toISOString(),
        };
        if (body.auto_print === true) patch.printed_at = new Date().toISOString();

        const { error: updErr } = await admin.from("orders").update(patch).eq("id", activeOrderId).eq("company_id", companyId);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
        oid = activeOrderId;
    } else {
        const displayCustomerName =
            String(body.customer_name ?? "").trim() ||
            (sellerName ? `[Balcão] ${sellerName}` : "Balcão");

        const { data: order, error: ordErr } = await admin
            .from("orders")
            .insert({
                company_id: companyId,
                sale_id: saleId,
                source: "pdv_direct",
                customer_id: customerId,
                customer_name: displayCustomerName,
                total: cartTotal,
                total_amount: cartTotal,
                delivery_fee: 0,
                payment_method: primary?.method ?? "pix",
                status: "finalized",
                channel: "balcao",
                paid: isPaid,
                confirmed_at: new Date().toISOString(),
            })
            .select("id")
            .single();
        if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });
        oid = order.id as string;

        const { error: itemErr } = await admin.from("order_items").insert(
            cart.map((i) => ({
                company_id: companyId,
                order_id: oid,
                product_id: i.produto_id,
                produto_embalagem_id: i.variant_id,
                product_name: `${i.product_name}${i.details ? ` ${i.details}` : ""}`,
                quantity: i.qty,
                qty: i.qty,
                unit_type: String(i.sigla_comercial ?? "").toUpperCase() === "CX" ? "case" : "unit",
                unit_price: i.unit_price,
            }))
        );
        if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }

    const { error: finErr } = await admin.from("financial_entries").insert(
        payments.map((p) => ({
            company_id: companyId,
            order_id: oid,
            sale_id: saleId,
            type: "income",
            amount: Number(p.value) || 0,
            delivery_fee: 0,
            payment_method: normMethod(p.method),
            origin: finEntryOrigin,
            description: `Venda PDV${sellerName ? ` — ${sellerName}` : ""}`,
            occurred_at: new Date().toISOString(),
            status: isPrazo(p.method) ? "pending" : "received",
            due_date: p.due_date ? new Date(`${p.due_date}T12:00:00`).toISOString() : null,
            received_at: !isPrazo(p.method) ? new Date().toISOString() : null,
        }))
    );
    if (finErr) return NextResponse.json({ error: finErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, sale_id: saleId, order_id: oid });
}
