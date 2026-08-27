import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    getChatbotOpsSnapshot,
    getDashboardStats,
    getOutboundHealthStats,
    getPipelineTurnTraces,
    getProPipelineHealthStats,
    getQueueHealthStats,
} from "@/lib/platform/services/platformOps";
import { parseOrdersFilterFromSearchParams } from "@/lib/platform/ordersFilters";

export const runtime = "nodejs";

function parseMinutes(url: URL): number {
    return Number(url.searchParams.get("minutes") ?? "15");
}

function parseCompanyId(url: URL): string | "all" {
    const raw = url.searchParams.get("company_id")?.trim();
    return raw && raw !== "all" ? raw : "all";
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "dashboard";
    const minutes = parseMinutes(url);
    const companyId = parseCompanyId(url);

    if (kind === "queue") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            return NextResponse.json(
                await getQueueHealthStats(ctx.admin, minutes, companyId)
            );
        });
    }

    if (kind === "pipeline") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            return NextResponse.json(
                await getProPipelineHealthStats(ctx.admin, minutes, companyId)
            );
        });
    }

    if (kind === "outbound") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            return NextResponse.json(
                await getOutboundHealthStats(ctx.admin, minutes, companyId)
            );
        });
    }

    if (kind === "ops") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            return NextResponse.json(
                await getChatbotOpsSnapshot(ctx.admin, minutes, companyId)
            );
        });
    }

    if (kind === "turn-traces") {
        return withPlatformAccess("platform.metrics.read", async (ctx) => {
            const limit = Number(url.searchParams.get("limit") ?? "25");
            return NextResponse.json(
                await getPipelineTurnTraces(ctx.admin, {
                    companyId: companyId === "all" ? undefined : companyId,
                    limit,
                })
            );
        });
    }

    return withPlatformAccess("platform.metrics.read", async (ctx) => {
        const filters = parseOrdersFilterFromSearchParams(url.searchParams);
        return NextResponse.json(await getDashboardStats(ctx.admin, filters));
    });
}
