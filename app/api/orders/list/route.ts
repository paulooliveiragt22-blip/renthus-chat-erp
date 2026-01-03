import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

function parseIntSafe(v: string | null, fallback: number) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseIntSafe(searchParams.get("limit"), 120), 300);

    // Opcional: filtro de status por querystring (?status=new)
    const status = searchParams.get("status");

    let q = admin
        .from("orders")
        .select(
            `
        id, status, total_amount, created_at,
        customers ( name, phone, address )
      `
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (status && status !== "all") {
        q = q.eq("status", status);
    }

    const { data, error } = await q;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ orders: data ?? [] });
}
