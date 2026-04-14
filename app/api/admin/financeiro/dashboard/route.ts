import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { buildFinanceDashboard } from "@/lib/server/financeiro/dashboardPayload";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const from = String(req.nextUrl.searchParams.get("from") ?? "").trim();
    const to = String(req.nextUrl.searchParams.get("to") ?? "").trim();
    const days = Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10));
    if (!from || !to) return NextResponse.json({ error: "from_to_required" }, { status: 400 });

    try {
        const { stats, expenses } = await buildFinanceDashboard(admin, companyId, { from, to, days });
        return NextResponse.json({ stats, expenses });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown_error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
