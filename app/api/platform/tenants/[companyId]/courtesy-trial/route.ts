import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import {
    GrantCourtesyTrial,
    type RpcExecutor,
} from "@/lib/billing/use-cases/grantCourtesyTrial";

export const runtime = "nodejs";

function makeRpc(ctxAdmin: unknown): RpcExecutor {
    const rpc = (ctxAdmin as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc;
    return async (fn, args) => rpc(fn, args);
}

/**
 * POST /api/platform/tenants/[companyId]/courtesy-trial
 * Body: { days: number, plan_key: "essencial"|"pro"|"market", reason?: string }
 * Superadmin only — 1 a 14 dias (validado no use case).
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
        const body = (await req.json().catch(() => ({}))) as {
            days?: number;
            plan_key?: string;
            planKey?: string;
            reason?: string;
        };

        const rpc = makeRpc(ctx.admin);
        const notifier = new ConsoleBillingNotifier();
        const uc = new GrantCourtesyTrial(rpc, notifier);

        try {
            const result = await uc.execute({
                companyId: companyId.trim(),
                days: Number(body.days ?? 0),
                planKey: String(body.plan_key ?? body.planKey ?? "") as "essencial" | "pro" | "market",
                reason: body.reason,
                actor: {
                    actorId: ctx.actor.id,
                    actorEmail: ctx.actor.email,
                    actorRole: ctx.actor.role,
                    requestId: ctx.requestId,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent ?? "unknown",
                },
            });
            return NextResponse.json({
                ok: true,
                company_id: companyId,
                trial_ends_at: result.trialEndsAt,
                days: result.days,
                plan_key: result.planKey,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[courtesy-trial] failed: ${msg}`);
            const status =
                msg.includes("already_paid") ||
                msg.includes("not_eligible") ||
                msg.includes("courtesy_trial_days_invalid") ||
                msg.includes("plan_key") ||
                msg.includes("plan_not_found")
                    ? 409
                    : 400;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
