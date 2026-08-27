import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { listPlatformAudit } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET(req: Request) {
    return withPlatformAccess("platform.audit.read", async (ctx) => {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const companyId = url.searchParams.get("company_id") ?? undefined;
        const action = url.searchParams.get("action") ?? undefined;
        const data = await listPlatformAudit(ctx.admin, { limit, offset, companyId, action });
        return NextResponse.json(data);
    });
}
