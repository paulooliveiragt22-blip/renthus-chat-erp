import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { updateChannelCredentials } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.channels.write", async (ctx) => {
        const body = await req.json();
        await updateChannelCredentials(ctx.admin, toAuditCtx(ctx), id, {
            phone_number_id: body.phone_number_id,
            access_token: body.access_token,
            waba_id: body.waba_id,
        });
        return NextResponse.json({ ok: true });
    });
}
