/**
 * Fecha o loop "atendente monta o carrinho → cliente confirma pelo WhatsApp"
 * (`whatsapp_order_confirmations`). Roda ANTES do gate de handover no worker:
 * independente de `bot_active`; sem IA.
 *
 * ADR-0005 C1: só IDs de botão (`pro_confirm_order` / `pro_cancel_order`).
 * Prosa (`sim` / `ok` / `CONFIRMAR`) não cria nem cancela pedido.
 *
 * Claim atômico (`UPDATE ... WHERE status='pending'`) evita duplo
 * processamento em retries: a segunda chamada não encontra `pending`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, TenantRef } from "@/src/types/contracts";
import { OrderServiceV2Adapter } from "@/src/pro/adapters/order/order.service.v2";
import { sendAndPersistWaText } from "@/lib/whatsapp/sendAndPersist";
import type { WaConfig } from "@/lib/whatsapp/send";
import type { MetricsPort } from "@/src/pro/ports/metrics.port";
import { detectStructuredCheckoutAction } from "./orderConfirmationText";

const CONFIRMATION_TTL_MS = 60 * 60 * 1000;

export type PendingOrderConfirmationIntent = "confirm" | "cancel" | null;

/** @deprecated Prefer `detectStructuredCheckoutAction` — mantido p/ testes e call sites. */
export function detectPendingConfirmationIntent(text: string): PendingOrderConfirmationIntent {
    return detectStructuredCheckoutAction(text);
}

function emitHitlMetric(
    metrics: MetricsPort | undefined,
    companyId: string,
    threadId: string,
    action: "confirm" | "cancel" | "expired" | "failed"
): void {
    metrics?.increment("pro_pipeline.hitl_confirmation", 1, {
        companyId,
        threadId,
        action,
    });
}

export async function tryResolvePendingOrderConfirmation(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    messageId: string;
    channelUserId?: string;
    inboundText: string;
    waConfig?: WaConfig;
    metrics?: MetricsPort;
}): Promise<boolean> {
    const {
        admin,
        companyId,
        threadId,
        phoneE164,
        messageId,
        channelUserId,
        inboundText,
        waConfig,
        metrics,
    } = params;

    const intent = detectStructuredCheckoutAction(inboundText);
    if (!intent) return false;

    const { data: claimed, error: claimErr } = await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "processing" })
        .eq("thread_id", threadId)
        .eq("status", "pending")
        .select("id, draft, created_at, customer_id")
        .maybeSingle();

    if (claimErr) {
        console.error("[resolvePendingOrderConfirmation] claim failed:", claimErr.message);
        return false;
    }
    if (!claimed) return false;

    const confirmationId = String(claimed.id);
    const createdAtMs = new Date(String(claimed.created_at)).getTime();
    const isExpired = Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CONFIRMATION_TTL_MS;

    if (isExpired) {
        await admin
            .from("whatsapp_order_confirmations")
            .update({ status: "expired", resolved_at: new Date().toISOString() })
            .eq("id", confirmationId);
        emitHitlMetric(metrics, companyId, threadId, "expired");
        await sendAndPersistWaText(admin, {
            threadId,
            phoneE164,
            waConfig,
            senderType: "bot",
            text: "Esse pedido expirou por falta de resposta. Fala com a gente que a gente monta de novo rapidinho. 🙂",
        });
        return true;
    }

    if (intent === "cancel") {
        await admin
            .from("whatsapp_order_confirmations")
            .update({ status: "cancelled", resolved_at: new Date().toISOString() })
            .eq("id", confirmationId);
        emitHitlMetric(metrics, companyId, threadId, "cancel");
        await sendAndPersistWaText(admin, {
            threadId,
            phoneE164,
            waConfig,
            senderType: "bot",
            text: "Tudo bem, pedido cancelado. Se quiser, é só chamar de novo por aqui. 🙂",
        });
        return true;
    }

    const draft = claimed.draft as OrderDraft;
    const tenant: TenantRef = {
        companyId,
        threadId,
        messageId,
        phoneE164,
        messagingChannel: "whatsapp",
        channelUserId: channelUserId || phoneE164,
    };

    const orderService = new OrderServiceV2Adapter(admin);
    const result = await orderService.createFromDraft({
        tenant,
        customerId: (claimed.customer_id as string | null) ?? "__missing_confirmation_customer__",
        draft,
        idempotencyKey: `whatsapp_order_confirmation:${confirmationId}`,
    });

    await admin
        .from("whatsapp_order_confirmations")
        .update({
            status: result.ok ? "confirmed" : "failed",
            order_id: result.ok ? result.orderId : null,
            resolved_at: new Date().toISOString(),
        })
        .eq("id", confirmationId);

    emitHitlMetric(metrics, companyId, threadId, result.ok ? "confirm" : "failed");

    await sendAndPersistWaText(admin, {
        threadId,
        phoneE164,
        waConfig,
        senderType: "bot",
        text: result.customerMessage,
    });

    return true;
}
