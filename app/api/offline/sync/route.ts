import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { DEFAULT_FLUSH_BATCH_SIZE } from "@/lib/offline/ports/SyncTransport";

export const runtime = "nodejs";

type SyncBody = {
    companyId?: string;
    commands?: unknown[];
};

/**
 * P0 stub (ADR-0008): autentica tenant e recusa aplicar mutação (501).
 * Aplicação real de comandos = fase P1 após D-P1…D-P5.
 */
export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    let body: SyncBody;
    try {
        body = (await req.json()) as SyncBody;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (body.companyId && body.companyId !== ctx.companyId) {
        return NextResponse.json({ error: "company_mismatch" }, { status: 403 });
    }

    const commands = Array.isArray(body.commands) ? body.commands : [];
    if (commands.length > DEFAULT_FLUSH_BATCH_SIZE) {
        return NextResponse.json(
            {
                error: "batch_too_large",
                max: DEFAULT_FLUSH_BATCH_SIZE,
            },
            { status: 400 }
        );
    }

    return NextResponse.json(
        {
            error: "offline_sync_not_implemented",
            notImplemented: true,
            companyId: ctx.companyId,
            received: commands.length,
            results: [],
        },
        { status: 501 }
    );
}
