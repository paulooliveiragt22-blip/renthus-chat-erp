import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { syncIfoodCatalogForCompany } from "@/src/marketplaces/services/syncIfoodCatalog";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST — Importar / sincronizar cardápio iFood (manual). */
export async function POST() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const result = await syncIfoodCatalogForCompany(admin, companyId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
