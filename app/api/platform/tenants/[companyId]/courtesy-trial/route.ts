import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { grantCourtesyTrial } from "@/lib/platform/services/platformNeverPaidTenants";

export const runtime = "nodejs";

const MAX_COURTESY_DAYS = 14;

/**
 * POST /api/platform/tenants/[companyId]/courtesy-trial
 * Body: { days: number, reason?: string }
 * Superadmin only — max 14 dias.
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
            reason?: string;
        };
        const days = Number(body.days);
        if (!Number.isFinite(days) || days < 1 || days > MAX_COURTESY_DAYS) {
            return NextResponse.json(
                { error: `days must be between 1 and ${MAX_COURTESY_DAYS}` },
                { status: 400 }
            );
        }

        try {
            const audit = toAuditCtx(ctx);
            const result = await grantCourtesyTrial(ctx.admin, ctx.actor, audit, {
                companyId: companyId.trim(),
                days: Math.floor(days),
                reason: body.reason,
            });
            return NextResponse.json({
                ok: true,
                company_id: companyId,
                trial_ends_at: result.trialEndsAt,
                days: Math.floor(days),
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg.includes("already_paid") || msg.includes("not_eligible") ? 409 : 400;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
