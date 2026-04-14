import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

const A_PRAZO_METHODS = new Set(["credit", "credit_installment", "boleto", "promissoria", "cheque"]);

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        payment_method?: string;
        due_date?: string;
        notes?: string;
        customer_id?: string | null;
        amount?: number;
    };

    const orderId = String(body.order_id ?? "").trim();
    const payment_method = String(body.payment_method ?? "pix");
    const due_date = String(body.due_date ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    const customerId = body.customer_id ? String(body.customer_id) : null;
    const amount = Number(body.amount ?? 0);

    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const isPrazo = A_PRAZO_METHODS.has(payment_method);

    const { error: orderErr } = await admin
        .from("orders")
        .update({ status: "finalized", payment_method, paid: !isPrazo })
        .eq("id", orderId)
        .eq("company_id", companyId);

    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

    if (isPrazo) {
        if (!customerId) return NextResponse.json({ error: "customer_required_for_prazo" }, { status: 400 });
        const { error: prazoErr } = await admin.from("bills").insert({
            company_id: companyId,
            type: "receivable",
            order_id: orderId,
            customer_id: customerId,
            amount,
            original_amount: amount,
            amount_paid: 0,
            due_date,
            status: "open",
            origin: "ui_order",
            payment_method,
            description: notes || `Pedido #${orderId.slice(-6).toUpperCase()}`,
        });
        if (prazoErr) return NextResponse.json({ error: prazoErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
