import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { updateSubscription } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const body = await req.json();
        await updateSubscription(ctx.admin, toAuditCtx(ctx), id, body);
        return NextResponse.json({ ok: true });
    });
}
