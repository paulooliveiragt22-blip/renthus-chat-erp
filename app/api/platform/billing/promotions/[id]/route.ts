import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    setPlanPromotionActive,
    upsertPlanPromotion,
} from "@/lib/platform/services/planPromotions";

export const runtime = "nodejs";

type Body = {
    active?: boolean;
    plan_id?: string;
    name?: string;
    starts_at?: string;
    ends_at?: string;
    duration_months?: number;
    adjustment_kind?: "discount" | "surcharge";
    adjustment_mode?: "percent" | "fixed_brl";
    adjustment_value?: number;
};

function isFullEdit(body: Body): boolean {
    return (
        typeof body.plan_id === "string" &&
        typeof body.starts_at === "string" &&
        typeof body.ends_at === "string" &&
        typeof body.duration_months === "number" &&
        typeof body.adjustment_mode === "string" &&
        typeof body.adjustment_value === "number"
    );
}

/**
 * PATCH /api/platform/billing/promotions/[id]
 * - `{ active }` → toggle kill-switch
 * - campos completos → editar campanha
 */
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
            if (isFullEdit(body)) {
                const promotion = await upsertPlanPromotion(
                    access.admin,
                    {
                        plan_id: String(body.plan_id),
                        name: typeof body.name === "string" ? body.name : "",
                        starts_at: String(body.starts_at),
                        ends_at: String(body.ends_at),
                        duration_months: Number(body.duration_months),
                        adjustment_kind:
                            body.adjustment_kind === "surcharge" ? "surcharge" : "discount",
                        adjustment_mode:
                            body.adjustment_mode === "fixed_brl" ? "fixed_brl" : "percent",
                        adjustment_value: Number(body.adjustment_value),
                        active: typeof body.active === "boolean" ? body.active : true,
                    },
                    toAuditCtx(access),
                    id
                );
                return NextResponse.json({ ok: true, promotion });
            }

            if (typeof body.active !== "boolean") {
                return NextResponse.json(
                    { error: "active_or_edit_fields_required" },
                    { status: 400 }
                );
            }

            const promotion = await setPlanPromotionActive(
                access.admin,
                id,
                body.active,
                toAuditCtx(access)
            );
            return NextResponse.json({ ok: true, promotion });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg === "promo_id_required" ||
                msg.endsWith("_invalid") ||
                msg.endsWith("_required")
                    ? 400
                    : 500;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
