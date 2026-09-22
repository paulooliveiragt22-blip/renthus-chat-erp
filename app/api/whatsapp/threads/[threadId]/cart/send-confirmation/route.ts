import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { loadWaConfigForCompany } from "@/lib/whatsapp/channelCredentials";
import { sendAndPersistWaButtons } from "@/lib/whatsapp/sendAndPersist";
import { HITL_ORDER_CONFIRM_BUTTONS } from "@/src/pro/pipeline/orderConfirmationText";
import { buildHitlSummaryText, parseAttendantCartBody } from "@/src/pro/pipeline/attendantCartDraft";
import { resumeThreadBot } from "@/src/pro/pipeline/resumeThreadBot";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/cart/send-confirmation
 *
 * Atendente monta o carrinho e pede confirmação do cliente. Não cria o pedido —
 * grava `whatsapp_order_confirmations` (pending) e envia interactive buttons.
 * Pedido só com clique em `pro_confirm_order` (ADR-0005 C1).
 *
 * O bot é religado ao enviar o resumo: o clique Confirmar e a conversa depois
 * dele seguem o fluxo do chatbot, sem depender do timeout de handover.
 */
export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId, userId } = ctx;

    const parsed = parseAttendantCartBody(await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.code, parsed.message, 400);
    const { draft, items, address, paymentMethod } = parsed;

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name, bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) {
        return jsonInternalError(threadErr, {
            route: "whatsapp/threads/:id/cart/send-confirmation:POST",
        });
    }
    if (!thread?.phone_e164) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    const customer = await getOrCreateCustomer(
        admin,
        companyId,
        thread.phone_e164 as string,
        thread.profile_name as string | null
    );

    await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .eq("status", "pending");

    const summaryText = buildHitlSummaryText({
        items,
        address,
        paymentMethod,
        deliveryFee: draft.deliveryFee,
        grandTotal: draft.grandTotal,
    });

    const { data: inserted, error: insertErr } = await admin
        .from("whatsapp_order_confirmations")
        .insert({
            company_id: companyId,
            thread_id: threadId,
            customer_id: customer?.id ?? null,
            draft,
            summary_text: summaryText,
            status: "pending",
            created_by: userId,
        })
        .select("id")
        .single();
    if (insertErr || !inserted?.id) {
        return jsonInternalError(insertErr ?? new Error("failed_to_create_confirmation"), {
            route: "whatsapp/threads/:id/cart/send-confirmation:POST",
            step: "insert_confirmation",
        });
    }

    /**
     * Religa o bot antes do envio: sem isso o clique Confirmar cai no gate de
     * handover do inbound e a confirmação fica `pending` para sempre.
     */
    if (thread.bot_active === false) {
        await resumeThreadBot({ admin, companyId, threadId });
    }

    const waConfig = await loadWaConfigForCompany(admin, companyId);
    const sendResult = await sendAndPersistWaButtons(admin, {
        threadId,
        phoneE164: thread.phone_e164 as string,
        bodyText: summaryText,
        buttons: [...HITL_ORDER_CONFIRM_BUTTONS],
        waConfig,
        senderType: "human",
    });

    if (!sendResult.ok) {
        return jsonError(
            "whatsapp_send_failed",
            sendResult.error || "Falha ao enviar a confirmação pelo WhatsApp.",
            502,
            { confirmationId: inserted.id }
        );
    }

    return NextResponse.json({
        ok: true,
        confirmationId: inserted.id,
        summaryText,
        botResumed: true,
    });
}
