import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { pollAndImportIfoodOrders } from "@/src/marketplaces/services/pollIfoodOrders";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST — Polling de eventos iFood + importação para Fila (mock se use_mock). */
export async function POST() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const feat = await requirePlanFeature(ctx.admin, ctx.companyId, "marketplace_ifood");
    if (!feat.ok) return feat.response;

    const result = await pollAndImportIfoodOrders(ctx.admin, ctx.companyId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
