/**
 * GET  /api/admin/products/categories — lista categorias ativas
 * POST /api/admin/products/categories — cria via rpc_create_category
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("view_categories")
        .select("id, name")
        .eq("is_active", true)
        .eq("company_id", companyId)
        .order("name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        categories: (data ?? []).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })),
    });
}

export async function POST(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_create_category", {
        p_company_id: companyId,
        p_name: name,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ id: String(data), name });
}
