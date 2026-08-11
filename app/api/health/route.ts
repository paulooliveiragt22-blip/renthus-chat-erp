/**
 * GET /api/health
 *
 * Health check público (sem sessão — allowlist em `proxy.ts`). Ping barato no
 * Postgres via `createAdminClient()`; usado por monitor externo de uptime
 * (Better Stack / Checkly / UptimeRobot). Ver
 * docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 2.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const startedAt = Date.now();
    const admin = createAdminClient();

    const { error } = await admin
        .from("companies")
        .select("id", { head: true, count: "exact" })
        .limit(1);

    const dbOk = !error;
    const body = {
        ok: dbOk,
        db: dbOk ? ("up" as const) : ("down" as const),
        ts: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
    };

    return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
