import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "member"], "financeiro.read");
    if (!ctx.ok) return ctx.response;
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
