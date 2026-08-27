import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    getQueueHealthStats,
    getSecurityOpsStatus,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return withPlatformAccess("platform.metrics.read", async (ctx) => {
        const startedAt = Date.now();
        const { error } = await ctx.admin
            .from("companies")
            .select("id", { head: true, count: "exact" })
            .limit(1);

        const dbOk = !error;
        let queue: Awaited<ReturnType<typeof getQueueHealthStats>> | null = null;
        try {
            queue = await getQueueHealthStats(ctx.admin, 15);
        } catch {
            queue = null;
        }

        const security = getSecurityOpsStatus();

        return NextResponse.json({
            ok: dbOk,
            db: dbOk ? "up" : "down",
            latencyMs: Date.now() - startedAt,
            ts: new Date().toISOString(),
            queue: queue
                ? {
                      pendingNow: queue.summary.pendingNow,
                      failed15m: queue.summary.failed15m,
                      failureRate: queue.summary.failureRate,
                      oldestPendingAgeSec: queue.summary.oldestPendingAgeSec,
                  }
                : null,
            security: {
                isProd: security.isProd,
                checksOk: security.checks.filter((c) => c.ok).length,
                checksTotal: security.checks.length,
                failing: security.checks.filter((c) => !c.ok).map((c) => c.key),
            },
        });
    });
}
