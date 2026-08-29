/**
 * Lambda handler — EventBridge reconcile outbox (ADR-0003 Fase 5).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOutbox } from "@/lib/queue/outboxReconcile";

export async function handler(): Promise<{ ok: boolean; stats: Awaited<ReturnType<typeof reconcileOutbox>> }> {
    const admin = createAdminClient();
    const stats = await reconcileOutbox(admin);
    return { ok: true, stats };
}
