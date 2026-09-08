import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { getThreadActiveCart } from "@/src/pro/pipeline/getThreadActiveCart";
import { OrderServiceV2Adapter } from "@/src/pro/adapters/order/order.service.v2";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, TenantRef } from "@/src/types/contracts";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/cart/finalize
 *
 * Finalização manual do carrinho pelo atendente — sem botões, sem pendência de confirmação.
 * Usado quando o atendente clica em \"Finalizar pedido\" no modal de carrinho.
 *
 * Requisitos:
 *   - Capability: whatsapp.operate (autenticado como atendente)
 *   - Estado do carrinho: deve haver um carrinho ativo (ativo ou abandonado)
 *   - Fluxo:
 *       1. Obter o carrinho ativo (GET)
 *       2. Validar draft (validation).
 *       3. Chamar OrderServiceV2Adapter.createFromDraft (mesmo que HITL usa) com idempotencyKey atendente-manual.
 *       4. Retornar o pedido criado.
 *   - Efeitos colaterais seguros:
 *       * Se houver uma whatsapp_order_confirmations (pending/processing) para a mesma thread, cancelá-la para não sobrar lixo.
 *       * Thread permanece pausada (bot_active=false) como após o send-confirmation.
 */

export async function POST(
    req: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId, userId } = ctx;

    // 1. Obter thread (precisamos de phone_e164 para o adapter)
    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name, bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) {
        return jsonInternalError(threadErr, {
            route: "whatsapp/threads/:id/cart/finalize:POST",
        });
    }
    if (!thread?.phone_e164) {
        return jsonError("thread_not_found", "Conversa não encontrada.", 404);
    }

    // 2. Obter carrinho ativo (ativo ou abandonado)
    const cart = await getThreadActiveCart({ admin, companyId, threadId });
    if (!cart || !cart.draft) {
        return jsonError(
            "cart_not_found",
            "Não há nenhum carrinho ativo para finalizar.",
            400,
        );
    }

    // 3. Se houver uma confirmação pendente (confirmar botões), cancelá-la para evitar confusão.
    const { data: pendingList } = await admin
        .from("whatsapp_order_confirmations")
        .select("id, status")
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .in("status", ["pending", "processing"]);

    if (pendingList?.length) {
        const ids = pendingList.map((p) => p.id);
        await admin
            .from("whatsapp_order_confirmations")
            .update({
                status: "cancelled",
                resolved_at: new Date().toISOString(),
                cancelled_by: userId,
            })
            .in("id", ids);
    }

    // 4. Preparar o draft a partir do carrinho
    const { items, address, paymentMethod, changeFor, deliveryFee, grandTotal } = cart.draft;

    const draft: OrderDraft = {
        items,
        address,
        paymentMethod,
        changeFor,
        deliveryFee,
        grandTotal,
        deliveryZoneId: null,
        deliveryAddressText: cart.draft.deliveryAddressText ?? null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: cart.totalItems,
        pendingConfirmation: false,
        version: 1,
    };

    // 5. Validar consistência (mesmo que send-confirmation faz)
    const { validateDraftConsistency } = await import(
        "@/src/pro/adapters/order/order.service.v2"
    );
    const consistency = validateDraftConsistency(draft);
    if (!consistency.ok) {
        return jsonError("inconsistent_draft", consistency.message, 400);
    }

    // 6. Executar criação via OrderServiceV2Adapter (mesmo que resolvePendingOrderConfirmation faz)
    const orderService = new OrderServiceV2Adapter(admin);
    const idempotencyKey = `attendant_manual:${userId}:${threadId}:${Date.now()}`;
    const messageId = `manual-finalize:${userId}:${threadId}:${Date.now()}`;
    const tenant: TenantRef = {
        companyId,
        threadId,
        messageId,
        phoneE164: thread.phone_e164 as string,
        messagingChannel: "whatsapp",
        channelUserId: userId,
    };
    const customer = await getOrCreateCustomer(
        admin,
        companyId,
        thread.phone_e164 as string,
        thread.profile_name as string | null
    );
    const orderResult = await orderService.createFromDraft({
        tenant,
        customerId: customer?.id ?? "__missing_handoff_customer__",
        draft,
        idempotencyKey,
    });

    if (!orderResult.ok) {
        return jsonError(
            "order_creation_failed",
            orderResult.errorCode ?? "Não foi possível criar o pedido.",
            502,
        );
    }

    return NextResponse.json({
        ok: true,
        orderId: orderResult.orderId,
        threadId,
        summary: orderResult.customerMessage,
    });
}