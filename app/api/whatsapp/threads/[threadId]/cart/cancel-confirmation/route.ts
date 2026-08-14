import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { loadWaConfigForCompany } from "@/lib/whatsapp/channelCredentials";
import { sendAndPersistWaText } from "@/lib/whatsapp/sendAndPersist";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/cart/cancel-confirmation
 *
 * Atendente desiste da solicitação de confirmação em aberto (ex.: percebeu um
 * erro no carrinho antes do cliente responder). Notifica o cliente pra não
 * ficar esperando confirmação de algo que não vale mais.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId } = ctx;

    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (!thread) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    const { data: cancelled, error } = await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
    if (error) return jsonInternalError(error, { route: "whatsapp/threads/:id/cart/cancel-confirmation:POST" });
    if (!cancelled) return NextResponse.json({ ok: true, cancelled: false });

    if (thread.phone_e164) {
        const waConfig = await loadWaConfigForCompany(admin, companyId);
        await sendAndPersistWaText(admin, {
            threadId,
            phoneE164: thread.phone_e164 as string,
            text: "Desconsidera o pedido que mandei confirmar — vamos ajustar aqui e já te chamamos de novo. 🙂",
            waConfig,
            senderType: "human",
        }).catch(() => { /* best-effort */ });
    }

    return NextResponse.json({ ok: true, cancelled: true });
}
