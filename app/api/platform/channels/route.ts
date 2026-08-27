import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    createChannel,
    getAllChannels,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.channels.read", async (ctx) => {
        const channels = await getAllChannels(ctx.admin);
        return NextResponse.json({ channels });
    });
}

export async function POST(req: Request) {
    return withPlatformAccess("platform.channels.write", async (ctx) => {
        const body = await req.json();
        if (!body.company_id) {
            return NextResponse.json({ error: "company_id required" }, { status: 400 });
        }
        await createChannel(ctx.admin, toAuditCtx(ctx), body.company_id, {
            phone_number_id: body.phone_number_id ?? "",
            access_token: body.access_token ?? "",
            waba_id: body.waba_id,
            whatsapp_phone: body.whatsapp_phone,
        });
        return NextResponse.json({ ok: true }, { status: 201 });
    });
}
