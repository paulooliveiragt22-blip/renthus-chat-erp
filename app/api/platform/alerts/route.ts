import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { evaluatePlatformAlerts } from "@/lib/platform/services/platformAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return withPlatformAccess("platform.metrics.read", async (ctx) => {
        const result = await evaluatePlatformAlerts(ctx.admin);
        return NextResponse.json(result);
    });
}
