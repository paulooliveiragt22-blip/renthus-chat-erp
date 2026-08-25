/**
 * POST /api/agent/activate  body: { code }
 * GET  /api/agent/activate?code=XXXX
 * Público: troca código de pareamento pela API key (one-time).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activatePairingCode } from "@/lib/print/pairing";
import {
    pruneRateLimitBuckets,
    rateLimitExceededResponse,
    RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/rateLimit";
import { checkRateLimitByIpAsync } from "@/lib/security/rateLimitDistributed";

export const runtime = "nodejs";

const AGENT_ACTIVATE_RATE_LIMIT = 20;

async function handleActivate(req: Request, code: string) {
    pruneRateLimitBuckets();
    const rl = await checkRateLimitByIpAsync(
        "agent-activate",
        req,
        AGENT_ACTIVATE_RATE_LIMIT,
        RATE_LIMIT_WINDOW_MS
    );
    if (!rl.allowed) {
        return rateLimitExceededResponse(rl, {
            error: "rate_limited",
            retry_after_sec: rl.retryAfterSeconds,
        });
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
