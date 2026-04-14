import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin } = ctx;

    const registerId = String(req.nextUrl.searchParams.get("register_id") ?? "").trim();
    if (!registerId) return NextResponse.json({ error: "register_id_required" }, { status: 400 });

    const { data, error } = await admin
        .from("cash_movements")
        .select("id, type, amount, reason, operator_name, occurred_at")
        .eq("cash_register_id", registerId)
        .order("occurred_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ movements: data ?? [] });
}
