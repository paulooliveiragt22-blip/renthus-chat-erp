import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
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

    return NextResponse.json({ bills });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amt = Number.parseFloat(String(body.amount ?? "0")) || 0;
    const due_date = String(body.due_date ?? "").trim();
    if (!due_date || amt <= 0) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

    const { error } = await admin.from("bills").insert({
        company_id: companyId,
        type: "payable",
        description: String(body.description ?? "").trim() || null,
        amount: amt,
        original_amount: amt,
        amount_paid: 0,
        saldo_devedor: amt,
        due_date,
        payment_method: String(body.payment_method ?? "pix") || null,
        status: "open",
        notes: String(body.notes ?? "").trim() || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        id?: string;
        pay_amount?: number;
        original_amount?: number;
        saldo_devedor?: number;
        payment_method?: string;
        received_at?: string;
    };

    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const paidNow = Number(body.pay_amount ?? 0) || 0;
    const original = Number(body.original_amount ?? 0);
    const saldo = Number(body.saldo_devedor ?? 0);
    const newAmountPaid = original - saldo + paidNow;

    const patch: Record<string, unknown> = {
        amount_paid: newAmountPaid,
        payment_method: body.payment_method ?? "pix",
    };
    if (newAmountPaid >= original && body.received_at) {
        patch.paid_at = new Date(`${body.received_at}T12:00:00`).toISOString();
    }

    const { error } = await admin.from("bills").update(patch).eq("id", id).eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
