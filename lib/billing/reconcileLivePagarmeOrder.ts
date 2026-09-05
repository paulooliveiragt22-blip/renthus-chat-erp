/**
 * Antes de criar novo order no PSP: se já há order_id local,
 * GET → paid → fulfill; senão cancel best-effort (anti-órfão H4.1/H4.2/H4.6).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { cancelPagarmeChargeBestEffort } from "@/lib/billing/pagarme";
import { fulfillIfPagarmeOrderPaid } from "@/lib/billing/syncPendingObligationFromPsp";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type ReconcileLiveOrderResult =
    | { action: "noop" }
    | { action: "fulfilled"; alreadyDone?: boolean }
    | { action: "cancelled" };

export async function reconcileOrCancelLiveOrder(
    admin: Admin,
    orderId: string | null | undefined,
    metaType: "invoice"
): Promise<ReconcileLiveOrderResult> {
    const oid = typeof orderId === "string" ? orderId.trim() : "";
    if (!oid) return { action: "noop" };

    const paid = await fulfillIfPagarmeOrderPaid(admin, oid, metaType);
    if (paid.fulfilled) {
        billingLog("psp_order", "reconcile_fulfilled", {
            order_id: oid,
            meta_type: metaType,
            already_done: paid.alreadyDone ?? false,
        });
        return { action: "fulfilled", alreadyDone: paid.alreadyDone };
    }

    await cancelPagarmeChargeBestEffort(oid);
    billingLog("psp_order", "reconcile_cancelled", {
        order_id: oid,
        meta_type: metaType,
    });
    return { action: "cancelled" };
}
