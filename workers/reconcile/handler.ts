/**
 * Lambda handler — EventBridge reconciler outbox (ADR-0003 Fase 14).
 *
 * DIFERENÇA vs Fase 13 (DLQ-only):
 *   - Fase 13 (Lambda direto do Vercel): reconciler só alertava Sentry;
 *     Lambda Async Invoke tinha retry x2 (4/8min) automático.
 *   - Fase 14 (SQS-first): reconciler reenfileira ativamente via SQS.
 *     `dispatchInboundJob` / `dispatchOutboundJob` cobrem o caso onde
 *     `SendMessage` falhou silenciosamente (network blip, IAM transient,
 *     throttling). Reconciler reenfileirador é **rede de segurança**, não
 *     caminho primário — webhook é responsável pelo dispatch normal.
 *
 * Sem dual path: reconciler enfileira via SQS (`dispatchInboundJob` /
 * `dispatchOutboundJob`) — nunca invoca Lambda diretamente, nunca envia
 * WhatsApp, nunca consulta SQS API.
 *
 * Schedule EventBridge: `rate(5 minutes)` (volta ao valor original Fase 0-6;
 * estava em `rate(15 minutes)` desde a Fase 7).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOutbox } from "@/lib/chatbot/queue/outboxReconcile";

export async function handler(): Promise<{ ok: boolean; stats: Awaited<ReturnType<typeof reconcileOutbox>> }> {
    const admin = createAdminClient();
    const stats = await reconcileOutbox(admin);
    return { ok: true, stats };
}
