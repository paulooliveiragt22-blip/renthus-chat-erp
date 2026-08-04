import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { syncMarketplaceCatalogForCompany } from "@/src/marketplaces/services/syncMarketplaceCatalog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await syncMarketplaceCatalogForCompany(ctx.admin, ctx.companyId, "aiqfome");
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
