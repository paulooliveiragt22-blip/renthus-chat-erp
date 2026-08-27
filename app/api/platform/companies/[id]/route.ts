import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    getCompany,
    updateCompany,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.companies.read", async (ctx) => {
        const data = await getCompany(ctx.admin, id);
        if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(data);
    });
}

export async function PATCH(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.companies.write", async (ctx) => {
        const body = await req.json();
        await updateCompany(ctx.admin, toAuditCtx(ctx), id, body);
        return NextResponse.json({ ok: true });
    });
}
