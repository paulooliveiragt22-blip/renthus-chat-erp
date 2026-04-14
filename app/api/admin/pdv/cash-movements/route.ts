import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        cash_register_id?: string;
        type?: "sangria" | "suprimento";
        amount?: number;
        reason?: string | null;
        operator_name?: string | null;
    };

    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    if (!cashRegisterId) return NextResponse.json({ error: "cash_register_id_required" }, { status: 400 });
    if (!body.type || (body.type !== "sangria" && body.type !== "suprimento")) {
        return NextResponse.json({ error: "type_invalid" }, { status: 400 });
    }

    const { error } = await admin.from("cash_movements").insert({
        cash_register_id: cashRegisterId,
        company_id: companyId,
        type: body.type,
        amount: Number(body.amount ?? 0),
        reason: body.reason?.trim() || null,
        operator_name: body.operator_name?.trim() || null,
        occurred_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
