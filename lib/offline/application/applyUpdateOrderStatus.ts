import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isOfflineOrderStatusAllowed } from "../domain/SyncEligibility";

export type ApplyOrderStatusResult =
    | { ok: true; status: string }
    | { ok: false; error: string; conflict?: boolean };

/**
 * Aplica mudança de status “leve” (P2). Finalize/cancel ficam online-only.
 */
export async function applyUpdateOrderStatus(args: {
    admin: SupabaseClient;
    companyId: string;
    orderId: string;
    status: string;
    details?: string | null;
    clientMutationId?: string | null;
}): Promise<ApplyOrderStatusResult> {
    const nextStatus = String(args.status).trim().toLowerCase();
    if (!isOfflineOrderStatusAllowed(nextStatus)) {
        return { ok: false, error: `status_not_offline_eligible:${nextStatus}` };
    }

    const { data: rpcData, error: sErr } = await args.admin.rpc("rpc_set_order_status", {
        p_company_id: args.companyId,
        p_order_id: args.orderId,
        p_status: nextStatus,
        p_details: args.details !== undefined ? args.details : null,
        p_payment_method: null,
    });

    if (sErr) {
        const msg = sErr.message ?? "status_update_failed";
        const conflict = /não permitida|não pode|inválido|pedido não encontrado/i.test(msg);
        return { ok: false, error: msg, conflict };
    }

    const result = (rpcData ?? {}) as { status?: string };
    return { ok: true, status: String(result.status ?? nextStatus) };
}
