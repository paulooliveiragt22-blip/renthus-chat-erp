import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { reactivateCompany } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.companies.suspend", async (ctx) => {
        const body = await req.json().catch(() => ({}));
        await reactivateCompany(
            ctx.admin,
            toAuditCtx(ctx),
            id,
            typeof body.reason === "string" ? body.reason : ""
        );
        return NextResponse.json({ ok: true });
    });
}
