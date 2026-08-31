import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import { ChangeSubscriptionPlan, type RpcExecutor } from "@/lib/billing/use-cases/changeSubscriptionPlan";
import type { SubscriptionPlanKey } from "@/lib/billing/contracts/status";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function makeRpc(): RpcExecutor {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error("Missing Supabase URL or service role key");
    return async (fn, args) => {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(args),
        });
        const text = await res.text();
        if (!res.ok) {
            let msg = text;
            try {
                const parsed = JSON.parse(text);
                msg = parsed.message ?? parsed.details ?? parsed.hint ?? text;
            } catch { /* keep text */ }
            return { data: null, error: { message: msg || `HTTP ${res.status}` } };
        }
        let data: unknown = text;
        try { data = JSON.parse(text); } catch { /* keep text */ }
        return { data, error: null };
    };
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

        const rpc = makeRpc();
        const notifier = new ConsoleBillingNotifier();
        const uc = new ChangeSubscriptionPlan(rpc, notifier);

        try {
            await uc.execute({
                subscriptionId: id,
                planKey,
                reason: typeof body.reason === "string" ? body.reason : "",
                actor: {
                    actorId: ctx.actor.id,
                    actorEmail: ctx.actor.email,
                    actorRole: ctx.actor.role,
                    requestId: ctx.requestId,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent ?? "unknown",
                },
            });
            return NextResponse.json({ ok: true });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return NextResponse.json({ error: msg }, { status: 400 });
        }
    });
}
