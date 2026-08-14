import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { buildExtratoLines } from "@/src/financeiro/application/queryExtrato";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "member"], "financeiro.read");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const from = String(req.nextUrl.searchParams.get("from") ?? "").trim();
    const to = String(req.nextUrl.searchParams.get("to") ?? "").trim();
    const cursor = String(req.nextUrl.searchParams.get("cursor") ?? "").trim() || null;
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
    if (!from || !to) return NextResponse.json({ error: "from_to_required" }, { status: 400 });

    try {
        const { lines, nextCursor } = await buildExtratoLines(
            admin,
            companyId,
            { from, to },
            undefined,
            { limit, cursor }
        );
        return NextResponse.json({ lines, nextCursor });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown_error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
