import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { getPlans } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.companies.read", async (ctx) => {
        const plans = await getPlans(ctx.admin);
        return NextResponse.json({ plans });
    });
}
