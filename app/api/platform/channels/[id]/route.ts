import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    updateChannelIdentifier,
    updateChannelStatus,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.channels.write", async (ctx) => {
        const body = await req.json();
        if (body.from_identifier) {
            await updateChannelIdentifier(ctx.admin, toAuditCtx(ctx), id, body.from_identifier);
        }
        if (body.status === "active" || body.status === "inactive") {
            await updateChannelStatus(ctx.admin, toAuditCtx(ctx), id, body.status);
        }
        return NextResponse.json({ ok: true });
    });
}
