import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getThreadActiveCart } from "@/src/pro/pipeline/getThreadActiveCart";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * GET /api/whatsapp/threads/:threadId/cart
 *
 * Carrinho atual do cliente (sessão do bot ainda ativa) ou último carrinho abandonado
 * dessa thread — pra facilitar o agente humano a fechar o pedido sem o cliente repetir
 * tudo que já disse pro bot.
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return jsonAccessError(ctx);

    const { admin, companyId } = ctx;

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (threadErr) return jsonInternalError(threadErr, { route: "whatsapp/threads/:id/cart:GET" });
    if (!thread) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    try {
        const cart = await getThreadActiveCart({ admin, companyId, threadId });

        // Motivo do handover (se houver ticket em aberto pra essa thread) — dá contexto
        // pro agente sobre por que o cliente pediu atendimento humano.
        const { data: ticket } = await admin
            .from("support_tickets")
            .select("message, created_at")
            .eq("company_id", companyId)
            .eq("thread_id", threadId)
            .in("status", ["open", "in_progress"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const handover = ticket
            ? { reason: (ticket.message as string | null) ?? null, since: ticket.created_at as string }
            : null;

        const customer = { phone: thread.phone_e164 as string | null, name: thread.profile_name as string | null };

        // Confirmação de pedido em aberto (atendente já pediu, aguardando CONFIRMAR/CANCELAR do cliente).
        const { data: pending } = await admin
            .from("whatsapp_order_confirmations")
            .select("id, summary_text, created_at")
            .eq("thread_id", threadId)
            .eq("company_id", companyId)
            .in("status", ["pending", "processing"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const pendingConfirmation = pending
            ? { id: pending.id as string, summaryText: pending.summary_text as string, createdAt: pending.created_at as string }
            : null;

        return NextResponse.json({ cart, handover, customer, pendingConfirmation });
    } catch (e) {
        return jsonInternalError(e, { route: "whatsapp/threads/:id/cart:GET", threadId });
    }
}
