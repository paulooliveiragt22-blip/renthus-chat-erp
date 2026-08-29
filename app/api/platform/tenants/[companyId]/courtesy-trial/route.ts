import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    grantCourtesyTrial,
    type CourtesyPlanKey,
} from "@/lib/platform/services/platformNeverPaidTenants";

export const runtime = "nodejs";

const MAX_COURTESY_DAYS = 30;
const ALLOWED_PLANS: ReadonlySet<CourtesyPlanKey> = new Set([
    "essencial",
    "pro",
    "market",
]);

/**
 * POST /api/platform/tenants/[companyId]/courtesy-trial
 * Body: { days: number, plan_key: "essencial"|"pro"|"market", reason?: string }
 * Superadmin only — 1 a 30 dias.
 */
export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ companyId: string }> }
) {
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        if (ctx.actor.role !== "superadmin") {
            return NextResponse.json(
                { error: "Courtesy trial requires superadmin role" },
                { status: 403 }
            );
        }

        const { companyId } = await ctxParams.params;
        if (!companyId?.trim()) {
            return NextResponse.json({ error: "companyId required" }, { status: 400 });
        }

        const body = (await req.json().catch(() => ({}))) as {
            days?: number;
            plan_key?: string;
            planKey?: string;
            reason?: string;
        };
        const days = Number(body.days);
        if (!Number.isFinite(days) || days < 1 || days > MAX_COURTESY_DAYS) {
            return NextResponse.json(
                { error: `days must be between 1 and ${MAX_COURTESY_DAYS}` },
                { status: 400 }
            );
        }

        const planKey = String(body.plan_key ?? body.planKey ?? "")
            .trim()
            .toLowerCase() as CourtesyPlanKey;
        if (!ALLOWED_PLANS.has(planKey)) {
            return NextResponse.json(
                { error: "plan_key must be one of essencial|pro|market" },
                { status: 400 }
            );
        }

        try {
            const audit = toAuditCtx(ctx);
            const result = await grantCourtesyTrial(ctx.admin, ctx.actor, audit, {
                companyId: companyId.trim(),
                days: Math.floor(days),
                planKey,
                reason: body.reason,
            });
            return NextResponse.json({
                ok: true,
                company_id: companyId,
                trial_ends_at: result.trialEndsAt,
                days: Math.floor(days),
                plan_key: result.planKey,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg.includes("already_paid") ||
                msg.includes("not_eligible") ||
                msg.includes("plan_key_invalid") ||
                msg.includes("plan_not_found")
                    ? 409
                    : 400;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
