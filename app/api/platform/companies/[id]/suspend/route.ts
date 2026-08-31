import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import { SuspendCompany, type RpcExecutor } from "@/lib/billing/use-cases/suspendCompany";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function makeRpc(ctxAdmin: unknown): RpcExecutor {
    const rpc = (ctxAdmin as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc;
    return async (fn, args) => rpc(fn, args);
}

export async function POST(req: Request, { params }: Ctx) {
    const { id } = await params;
    return withPlatformAccess("platform.companies.suspend", async (ctx) => {
        const body = (await req.json().catch(() => ({}))) as { reason?: string };
        const rpc = makeRpc(ctx.admin);
        const notifier = new ConsoleBillingNotifier();
        const uc = new SuspendCompany(rpc, notifier);

        try {
            await uc.execute({
                companyId: id,
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
