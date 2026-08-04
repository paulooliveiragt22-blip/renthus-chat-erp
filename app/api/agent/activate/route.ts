/**
 * POST /api/agent/activate  body: { code }
 * GET  /api/agent/activate?code=XXXX
 * Público: troca código de pareamento pela API key (one-time).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activatePairingCode } from "@/lib/print/pairing";
import { pruneRateLimitBuckets, simpleRateLimit } from "@/lib/http/simpleRateLimit";

export const runtime = "nodejs";

function clientIp(req: Request): string {
    const xf = req.headers.get("x-forwarded-for");
    if (xf) return xf.split(",")[0]?.trim() || "unknown";
    return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function handleActivate(req: Request, code: string) {
    pruneRateLimitBuckets();
    const rl = simpleRateLimit({
        key: `agent-activate:${clientIp(req)}`,
        limit: 20,
        windowMs: 60_000,
    });
    if (!rl.ok) {
        return NextResponse.json(
            { error: "rate_limited", retry_after_sec: rl.retryAfterSec },
            {
                status: 429,
                headers: { "Retry-After": String(rl.retryAfterSec) },
            }
        );
    }

    const admin = createAdminClient();
    const result = await activatePairingCode(admin, code);
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
        ok: true,
        api_key: result.apiKey,
        agent_id: result.agentId,
        server_url: result.serverHint || undefined,
    });
}

export async function POST(req: Request) {
    const body = (await req.json().catch(() => ({}))) as { code?: string };
    const code = typeof body.code === "string" ? body.code : "";
    return handleActivate(req, code);
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    return handleActivate(req, code);
}
