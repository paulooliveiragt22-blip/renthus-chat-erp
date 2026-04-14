import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { buildFinanceDashboard } from "@/lib/server/financeiro/dashboardPayload";
import { buildExtratoLines } from "@/lib/server/financeiro/extratoPayload";

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
        const { expenses } = await buildFinanceDashboard(admin, companyId, { from, to, days });
        const lines = await buildExtratoLines(admin, companyId, { from, to }, expenses);
        return NextResponse.json({ lines });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown_error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
