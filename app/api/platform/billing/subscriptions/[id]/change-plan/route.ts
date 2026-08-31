import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import { ChangeSubscriptionPlan, type RpcExecutor } from "@/lib/billing/use-cases/changeSubscriptionPlan";
import type { SubscriptionPlanKey } from "@/lib/billing/contracts/status";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function makeRpc(ctxAdmin: unknown): RpcExecutor {
    // Adapter mínimo: usa client.rpc do Supabase service-role
    const rpc = (ctxAdmin as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc;
    return async (fn, args) => rpc(fn, args);
}

export async function POST(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const body = (await req.json().catch(() => ({}))) as {
            plan_key?: string;
            reason?: string;
        };
        const planKey = (typeof body.plan_key === "string" ? body.plan_key.trim() : "") as SubscriptionPlanKey;
        if (!planKey) {
            return NextResponse.json({ error: "plan_key required" }, { status: 400 });
        }

        const rpc = makeRpc(ctx.admin);
        const notifier = new ConsoleBillingNotifier();
        const uc = new ChangeSubscriptionPlan(rpc, notifier);

        try {
            await uc.execute({
                subscriptionId: id,
                planKey,
                reason: typeof body.reason === "string" ? body.reason : "",
            });
            return NextResponse.json({ ok: true });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return NextResponse.json({ error: msg }, { status: 400 });
        }
    });
}
