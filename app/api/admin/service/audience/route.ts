import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { parseSiteAudienceDays } from "@/src/service/domain/siteAudience";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess({ allowedRoles: ["owner", "admin", "member"] });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const days = parseSiteAudienceDays(new URL(req.url).searchParams.get("days"));
    const result = await callServiceRpc(ctx.admin, "rpc_site_audience_summary", {
        p_company_id: ctx.companyId,
        p_days: days,
    });
    return NextResponse.json(result.body, { status: result.status });
}
