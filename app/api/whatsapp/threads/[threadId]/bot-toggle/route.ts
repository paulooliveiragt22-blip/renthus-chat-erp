import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/bot-toggle
 *
 * Liga/desliga o bot para uma thread específica.
 * Usado pela inbox para retomar o atendimento automático após handover.
 *
 * Body: { bot_active: boolean }
 */
export async function POST(
    req: Request,
    { params }: { params: { threadId: string } }
) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const threadId = params.threadId;

    const body = await req.json().catch(() => ({})) as { bot_active?: boolean };
    const botActive = typeof body.bot_active === "boolean" ? body.bot_active : null;

    if (botActive === null) {
        return NextResponse.json({ error: "bot_active (boolean) obrigatório" }, { status: 400 });
    }

    // Verifica que a thread pertence à company
    const { data: thread, error: fetchErr } = await admin
        .from("whatsapp_threads")
        .select("id, bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!thread) return NextResponse.json({ error: "thread_not_found" }, { status: 404 });

    const updatePayload: Record<string, any> = { bot_active: botActive };

    // Se estiver reativando o bot, limpa o handover
    if (botActive) {
        updatePayload.handover_at = null;
    }

    const { error: updateErr } = await admin
        .from("whatsapp_threads")
        .update(updatePayload)
        .eq("id", threadId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, bot_active: botActive });
}
