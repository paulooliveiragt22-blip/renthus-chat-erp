import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { getAllOrders } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET(req: Request) {
    return withPlatformAccess("platform.orders.read", async (ctx) => {
        const url = new URL(req.url);
        const page = Number(url.searchParams.get("page") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const data = await getAllOrders(ctx.admin, page, limit);
        return NextResponse.json(data);
    });
}
