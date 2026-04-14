import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amount = Number.parseFloat(String(body.amount ?? "").replaceAll(",", "."));
    const due_date = String(body.due_date ?? "").trim();
    if (!due_date || Number.isNaN(amount)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

    const payment_status = String(body.payment_status ?? "pending");
    const row: Record<string, unknown> = {
        company_id: companyId,
        category: String(body.category ?? ""),
        description: String(body.description ?? ""),
        amount,
        due_date,
        payment_status,
    };
    if (payment_status === "paid") row.paid_at = new Date().toISOString();

    const { error } = await admin.from("expenses").insert(row);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.from("expenses").delete().eq("id", id).eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    if (body.action !== "mark_paid") return NextResponse.json({ error: "invalid_action" }, { status: 400 });

    const { error } = await admin
        .from("expenses")
        .update({ payment_status: "paid", paid_at: new Date().toISOString() })
        .eq("id", id)
        .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
