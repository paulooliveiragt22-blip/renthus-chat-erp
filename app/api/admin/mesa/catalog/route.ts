import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "12") || 12;

    if (q.length < 2) {
        return NextResponse.json({ ok: true, rows: [] });
    }

    const { data, error } = await admin.rpc("rpc_mesa_search_catalog", {
        p_company_id: companyId,
        p_query: q,
        p_limit: limit,
    });
    if (error) return mesaRpcError(error, "catalog_failed");
    return NextResponse.json(data ?? { ok: true, rows: [] });
}
