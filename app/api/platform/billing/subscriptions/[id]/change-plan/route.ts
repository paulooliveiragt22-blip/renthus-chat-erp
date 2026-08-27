import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { changeSubscriptionPlan } from "@/lib/platform/services/platformBilling";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const body = await req.json().catch(() => ({}));
        const planKey = typeof body.plan_key === "string" ? body.plan_key.trim() : "";
        if (!planKey) {
            return NextResponse.json({ error: "plan_key required" }, { status: 400 });
        }
        await changeSubscriptionPlan(
            ctx.admin,
            toAuditCtx(ctx),
            id,
            planKey,
            typeof body.reason === "string" ? body.reason : ""
        );
        return NextResponse.json({ ok: true });
    });
}
