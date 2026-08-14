import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import {
    parseMenuAnalyticsRpc,
    resolveAnalyticsRange,
} from "@/lib/public-menu/parseMenuAnalytics";

export const runtime = "nodejs";

/**
 * GET /api/admin/menu-analytics?days=7|14|30|90
 * Agregados do cardápio web (visitas, top produtos, UTM).
 */
export async function GET(req: NextRequest) {
    const ctx = await requireCapability("menu.manage");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { days, from, to } = resolveAnalyticsRange(req.nextUrl.searchParams.get("days"));

    const { data, error } = await admin.rpc("rpc_get_menu_analytics", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
    });

    if (error) {
        console.error("[menu-analytics]", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const analytics = parseMenuAnalyticsRpc(data);
    if (!analytics) {
        return NextResponse.json({ error: "parse_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, days, analytics });
}
