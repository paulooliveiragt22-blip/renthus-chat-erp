import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { settleBill } from "@/src/financeiro/application/settleBill";
import { postOpex } from "@/src/financeiro/application/postOpex";
import { queryAging } from "@/src/financeiro/application/queryAging";
import {
    enforceFinanceWriteRateLimit,
    financeRpcFailure,
} from "@/src/financeiro/application/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "member"], "financeiro.read");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const type = String(req.nextUrl.searchParams.get("type") ?? "receivable") as "receivable" | "payable";
    const statusFilter = String(req.nextUrl.searchParams.get("status") ?? "open");

    let q = admin
        .from("bills")
        .select(
            `
                id, type, description, original_amount, saldo_devedor,
                due_date, status, payment_method, sale_id, order_id,
                customers(name)
            `
        )
        .eq("company_id", companyId)
        .eq("type", type)
        .order("due_date", { ascending: true });

    if (statusFilter !== "all") q = q.eq("status", statusFilter);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const bills = (data ?? []).map((b: Record<string, unknown>) => ({
        ...b,
        customer_name: (b.customers as { name?: string } | null)?.name ?? null,
    }));

    let aging = null;
    if (type === "receivable") {
        try {
            aging = await queryAging(admin, companyId);
        } catch (e) {
            console.error("[financeiro/bills] aging", e instanceof Error ? e.message : e);
        }
    }

    return NextResponse.json({ bills, aging });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "opex");
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amt = Number.parseFloat(String(body.amount ?? "0")) || 0;
    const due_date = String(body.due_date ?? "").trim();
    if (!due_date || amt <= 0) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

    const idempotencyKey =
        String(body.idempotency_key ?? "").trim() ||
        `opex:${companyId}:${due_date}:${amt}:${String(body.description ?? "")}`;

    try {
        await postOpex(admin, {
            companyId,
            payload: {
                category: String(body.description ?? "").trim() || "outros",
                description: String(body.notes ?? "").trim(),
                amount: amt,
                due_date,
                payment_status: "pending",
                payment_method: String(body.payment_method ?? "pix"),
                idempotency_key: idempotencyKey,
            },
        });
    } catch (err) {
        return financeRpcFailure(err instanceof Error ? err.message : "opex_failed");
    }
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "settle");
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as {
        id?: string;
        pay_amount?: number;
        payment_method?: string;
        received_at?: string;
        idempotency_key?: string;
    };

    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const paidNow = Number(body.pay_amount ?? 0) || 0;
    const receivedDay =
        body.received_at && String(body.received_at).trim() !== ""
            ? String(body.received_at).trim().slice(0, 10)
            : null;

    try {
        await settleBill(admin, {
            companyId,
            billId: id,
            payAmount: paidNow,
            paymentMethod: String(body.payment_method ?? "pix"),
            receivedAt: receivedDay,
            idempotencyKey: body.idempotency_key?.trim() || null,
        });
    } catch (err) {
        return financeRpcFailure(err instanceof Error ? err.message : "settle_failed");
    }
    return NextResponse.json({ ok: true });
}
