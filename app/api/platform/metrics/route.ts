import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    getDashboardStats,
    getProPipelineHealthStats,
    getQueueHealthStats,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "dashboard";

    if (kind === "queue") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            const minutes = Number(url.searchParams.get("minutes") ?? "15");
            return NextResponse.json(await getQueueHealthStats(ctx.admin, minutes));
        });
    }

    if (kind === "pipeline") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            const minutes = Number(url.searchParams.get("minutes") ?? "15");
            return NextResponse.json(await getProPipelineHealthStats(ctx.admin, minutes));
        });
    }

    return withPlatformAccess("platform.metrics.read", async (ctx) => {
        return NextResponse.json(await getDashboardStats(ctx.admin));
    });
}
