/**
 * POST /api/admin/print-agents/pairing
 * Gera agente + código curto de pareamento (one-time, TTL 15 min).
 * Exige plano com printing_auto (Pro/Market).
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { createAgentWithPairingCode } from "@/lib/print/pairing";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const feat = await requirePlanFeature(ctx.admin, ctx.companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as { name?: string; ttlMinutes?: number };

    try {
        const result = await createAgentWithPairingCode(ctx.admin, {
            companyId: ctx.companyId,
            agentName: typeof body.name === "string" ? body.name : undefined,
            createdBy: ctx.userId ?? null,
            ttlMinutes: typeof body.ttlMinutes === "number" ? body.ttlMinutes : 15,
        });

        return NextResponse.json({
            ok: true,
            agentId: result.agentId,
            agentName: result.agentName,
            code: result.code,
            expiresAt: result.expiresAt,
            apiKeyPrefix: result.apiKeyPrefix,
            instructions:
                "No Print Agent, informe este código e a URL do servidor. O código expira em poucos minutos e só funciona uma vez.",
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = msg.includes("encryption_unavailable") ? 500 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
}
