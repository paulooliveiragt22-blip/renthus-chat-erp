import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { updatePlanPricing } from "@/lib/platform/services/updatePlanPricing";

export const runtime = "nodejs";

type Body = {
    price_cents?: number;
    price_year_cents?: number | null;
    included_seats?: number;
    seat_extra_cents?: number | null;
};

export async function PATCH(
    req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    return withPlatformAccess("platform.billing.write", async (access) => {
        let body: Body;
        try {
            body = (await req.json()) as Body;
        } catch {
            return NextResponse.json({ error: "invalid_json" }, { status: 400 });
        }

        try {
            const plan = await updatePlanPricing(access.admin, id, body, toAuditCtx(access));
            return NextResponse.json({ ok: true, plan });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg === "plan_not_found"
                    ? 404
                    : msg.endsWith("_invalid") || msg === "plan_id_required"
                      ? 400
                      : 500;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
