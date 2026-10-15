import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const { data, error } = await admin
        .from("v_sec_combos")
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ combos: data ?? [] });
}

export async function POST(req: NextRequest) {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { data, error } = await admin.rpc("rpc_upsert_combo", {
        p_company_id: companyId,
        p_payload: body,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
}
