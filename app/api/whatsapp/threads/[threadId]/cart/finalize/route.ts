import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { OrderServiceV2Adapter } from "@/src/pro/adapters/order/order.service.v2";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { loadWaConfigForCompany } from "@/lib/whatsapp/channelCredentials";
import { sendAndPersistWaText } from "@/lib/whatsapp/sendAndPersist";
import {
    attendantFinalizeIdempotencyKey,
    parseAttendantCartBody,
} from "@/src/pro/pipeline/attendantCartDraft";
import { resumeThreadBot } from "@/src/pro/pipeline/resumeThreadBot";
import type { TenantRef } from "@/src/types/contracts";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/cart/finalize
 *
 * Finalização manual: o cliente já deu o ok na conversa e o **atendente** fecha o
 * pedido. Sem botão de confirmação, sem IA, sem `whatsapp_order_confirmations`.
 *
 * Pedido entra `confirmed` (não passa pela fila de aprovação admin) porque quem
 * aprovou foi o atendente. O cliente recebe a confirmação canônica no WhatsApp.
 * Mutação financeira continua só via `create_order_with_items`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId, userId } = ctx;

    const parsed = parseAttendantCartBody(await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.code, parsed.message, 400);
    const { draft } = parsed;

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name, bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) {
        return jsonInternalError(threadErr, { route: "whatsapp/threads/:id/cart/finalize:POST" });
    }
    if (!thread?.phone_e164) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    /**
     * Confirmação em aberto (atendente mandou botões antes e resolveu fechar na
     * mão) sai de cena: senão o cliente clica Confirmar depois e cria 2º pedido.
     */
    await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .in("status", ["pending", "processing"]);

    const customer = await getOrCreateCustomer(
        admin,
        companyId,
        thread.phone_e164 as string,
        thread.profile_name as string | null
    );
    if (!customer?.id) {
        return jsonError("customer_unavailable", "Não foi possível identificar o cliente.", 502);
    }

    const tenant: TenantRef = {
        companyId,
        threadId,
        messageId: `attendant_finalize:${userId}`,
        phoneE164: thread.phone_e164 as string,
        messagingChannel: "whatsapp",
        channelUserId: thread.phone_e164 as string,
    };

    const orderService = new OrderServiceV2Adapter(admin);
    const orderResult = await orderService.createFromDraft({
        tenant,
        customerId: customer.id,
        draft,
        idempotencyKey: attendantFinalizeIdempotencyKey(threadId, userId, draft),
        forceConfirmed: true,
        source: "ui",
    });

    if (!orderResult.ok) {
        return jsonError(
            "order_creation_failed",
            orderResult.customerMessage,
            orderResult.retryable ? 502 : 400,
            { errorCode: orderResult.errorCode }
        );
    }

    const waConfig = await loadWaConfigForCompany(admin, companyId);
    const sendResult = await sendAndPersistWaText(admin, {
        threadId,
        phoneE164: thread.phone_e164 as string,
        text: orderResult.customerMessage,
        waConfig,
        senderType: "human",
    });

    if (thread.bot_active === false) {
        await resumeThreadBot({ admin, companyId, threadId });
    }

    return NextResponse.json({
        ok: true,
        orderId: orderResult.orderId,
        customerNotified: sendResult.ok,
        botResumed: true,
    });
}
