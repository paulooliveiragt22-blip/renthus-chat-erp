import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { setSubscriptionOverage } from "@/lib/platform/services/platformBilling";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const body = await req.json().catch(() => ({}));
        if (typeof body.allow_overage !== "boolean") {
            return NextResponse.json({ error: "allow_overage boolean required" }, { status: 400 });
        }
        await setSubscriptionOverage(
            ctx.admin,
            toAuditCtx(ctx),
            id,
            body.allow_overage,
            typeof body.reason === "string" ? body.reason : ""
        );
        return NextResponse.json({ ok: true });
    });
}
