import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { getAllOrders } from "@/lib/platform/services/platformOps";
import { parseOrdersFilterFromSearchParams } from "@/lib/platform/ordersFilters";

export const runtime = "nodejs";

export async function GET(req: Request) {
    return withPlatformAccess("platform.orders.read", async (ctx) => {
        const url = new URL(req.url);
        const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);
        const limit = Math.min(
            Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1),
            100
        );
        const filters = parseOrdersFilterFromSearchParams(url.searchParams);
        const data = await getAllOrders(ctx.admin, page, limit, filters);
        return NextResponse.json(data);
    });
}
