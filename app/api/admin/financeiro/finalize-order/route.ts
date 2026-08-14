import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { recognizeOrderSale } from "@/src/financeiro/application/recognizeOrderSale";
import {
    enforceFinanceWriteRateLimit,
    financeRpcFailure,
} from "@/src/financeiro/application/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "finalize_order");
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        payment_method?: string;
        due_date?: string;
        notes?: string;
        customer_id?: string | null;
        amount?: number;
        idempotency_key?: string;
    };

    const orderId = String(body.order_id ?? "").trim();
    const payment_method = String(body.payment_method ?? "pix");
    const due_date = String(body.due_date ?? "").trim();

    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const { error: orderErr } = await admin.rpc("rpc_set_order_status", {
        p_company_id: companyId,
        p_order_id: orderId,
        p_status: "finalized",
        p_payment_method: payment_method,
        p_details: body.notes != null ? String(body.notes) : null,
    });

    if (orderErr) {
        const msg = orderErr.message ?? "status_update_failed";
        const conflict = /não permitida|não pode|inválido|pedido não encontrado/i.test(msg);
        return NextResponse.json({ error: msg }, { status: conflict ? 409 : 500 });
    }

    try {
        await recognizeOrderSale(admin, {
            companyId,
            orderId,
            idempotencyKey: body.idempotency_key?.trim() || `order:${orderId}:recognize`,
            dueDate: due_date || null,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "recognize_failed";
        return financeRpcFailure(msg);
    }

    return NextResponse.json({ ok: true });
}
