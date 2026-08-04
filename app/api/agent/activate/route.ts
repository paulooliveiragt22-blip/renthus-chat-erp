/**
 * POST /api/agent/activate
 * Body: { code: string }
 * Público (sem sessão): troca código de pareamento pela API key (one-time).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activatePairingCode } from "@/lib/print/pairing";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const body = (await req.json().catch(() => ({}))) as { code?: string };
    const code = typeof body.code === "string" ? body.code : "";

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
