/**
 * GET /api/admin/products/names?q= — busca nomes (rpc_search_products_by_name)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    const { data, error } = await admin.rpc("rpc_search_products_by_name", {
        p_company_id: companyId,
        p_search: q || null,
        p_limit: 15,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        products: ((data ?? []) as Array<{ id?: string; name?: string }>).map((r) => ({
            id: String(r.id ?? ""),
            name: String(r.name ?? ""),
        })),
    });
}
