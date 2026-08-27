import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { listSubscriptions } from "@/lib/platform/services/platformBilling";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.billing.read", async (ctx) => {
        const subscriptions = await listSubscriptions(ctx.admin);
        return NextResponse.json({ subscriptions });
    });
}
