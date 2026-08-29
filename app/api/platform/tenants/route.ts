import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { listNeverPaidTenants } from "@/lib/platform/services/platformNeverPaidTenants";

export const runtime = "nodejs";

/**
 * GET /api/platform/tenants?billing=never_paid&page=0&limit=50
 */
export async function GET(req: Request) {
    return withPlatformAccess("platform.billing.read", async (ctx) => {
        const url = new URL(req.url);
        const billing = url.searchParams.get("billing")?.trim();

        if (billing !== "never_paid") {
            return NextResponse.json(
                {
                    error: "Unsupported billing filter. Use billing=never_paid.",
                },
                { status: 400 }
            );
        }

        const page = Number(url.searchParams.get("page") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");

        const data = await listNeverPaidTenants(ctx.admin, { page, limit });
        return NextResponse.json({ ok: true, billing: "never_paid", ...data });
    });
}
