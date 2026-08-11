import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const FINALIZE_ORDER_RATE_LIMIT = 30;
const FINALIZE_ORDER_RATE_WINDOW_MS = 60_000;

const A_PRAZO_METHODS = new Set(["credit", "credit_installment", "boleto", "promissoria", "cheque"]);

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const rl = checkRateLimit(
        `financeiro_finalize_order:${companyId}`,
        FINALIZE_ORDER_RATE_LIMIT,
        FINALIZE_ORDER_RATE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

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

        // Idempotência: 1 pedido só pode gerar 1 lançamento "a prazo" aqui —
        // usa o próprio order_id como chave (retry/double-click não duplica
        // `bills`). Índice único em (company_id, idempotency_key), ver
        // 20260811120000_bills_idempotency_key.sql.
        const { data: existingBill } = await admin
            .from("bills")
            .select("id")
            .eq("company_id", companyId)
            .eq("idempotency_key", orderId)
            .maybeSingle();

        if (!existingBill) {
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
                idempotency_key: orderId,
            });
            if (prazoErr && (prazoErr as { code?: string }).code !== "23505") {
                return NextResponse.json({ error: prazoErr.message }, { status: 500 });
            }
        }
    }

    return NextResponse.json({ ok: true });
}
