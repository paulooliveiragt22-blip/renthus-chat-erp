import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

const PRAZO_PAYMENT_METHODS = ["credit", "boleto", "cheque", "promissoria", "credit_installment"];

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("cash_registers")
        .select("id, opened_at, operator_name, initial_amount")
        .eq("company_id", companyId)
        .eq("status", "open")
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ caixa: null });

    const [movRes, salesRes] = await Promise.all([
        admin.from("cash_movements").select("type, amount").eq("cash_register_id", data.id),
        admin
            .from("sale_payments")
            .select("amount, payment_method")
            .eq("company_id", companyId)
            .gte("created_at", data.opened_at),
    ]);

    const movements = (movRes.data ?? []) as { type: string; amount: number }[];
    const salePayments = (salesRes.data ?? []) as { amount: number; payment_method: string }[];

    const totalIn =
        salePayments
            .filter((p) => !PRAZO_PAYMENT_METHODS.includes(String(p.payment_method ?? "")))
            .reduce((s, p) => s + Number(p.amount), 0) +
        movements.filter((m) => m.type === "suprimento").reduce((s, m) => s + Number(m.amount), 0) +
        Number(data.initial_amount ?? 0);
    const totalOut = movements.filter((m) => m.type === "sangria").reduce((s, m) => s + Number(m.amount), 0);

    return NextResponse.json({
        caixa: {
            ...data,
            total_in: totalIn,
            total_out: totalOut,
            balance_expected: totalIn - totalOut,
        },
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        operator_name?: string | null;
        initial_amount?: number;
    };

    const { error } = await admin.rpc("rpc_open_cash_register", {
        p_company_id: companyId,
        p_operator_name: body.operator_name?.trim() ?? "",
        p_initial_amount: Number(body.initial_amount ?? 0),
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
        closing_amount?: number;
        balance_expected?: number;
    };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const counted = Number(body.closing_amount ?? 0);
    const expected = Number(body.balance_expected ?? 0);

    const { error } = await admin.rpc("rpc_close_cash_register", {
        p_company_id: companyId,
        p_register_id: id,
        p_closing_amount: counted,
        p_balance_expected: expected,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
