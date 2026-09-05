/**
 * Transições críticas de pagarme_subscriptions.status — só via RPC (CAS + allowlist).
 * App não calcula grace/allowlist; o banco recusa race (fulfill → active).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type BillingStatusTransitionTo =
    | "overdue"
    | "pending_payment"
    | "blocked"
    | "abandoned";

export type BillingStatusTransitionResult = {
    status: "transitioned" | "already" | "conflict";
    claimed: boolean;
    from?: string | null;
    to?: string;
    reason?: string;
};

type TransitionRpcRow = {
    status?: string;
    claimed?: boolean;
    from?: string | null;
    to?: string;
    reason?: string;
};

export async function transitionBillingStatus(
    admin: Admin,
    params: {
        companyId: string;
        to: BillingStatusTransitionTo;
        casUpdatedAt?: string | null;
    }
): Promise<BillingStatusTransitionResult> {
    const { data, error } = await admin.rpc("rpc_transition_billing_status", {
        p_company_id: params.companyId,
        p_to: params.to,
        p_cas_updated_at: params.casUpdatedAt ?? null,
    });
    if (error) {
        throw new Error(error.message);
    }
    const row = (data ?? {}) as TransitionRpcRow;
    const status =
        row.status === "already" || row.status === "conflict" || row.status === "transitioned"
            ? row.status
            : "conflict";
    return {
        status,
        claimed: Boolean(row.claimed),
        from: row.from ?? null,
        to: row.to,
        reason: row.reason,
    };
}

export async function expireDueTrials(
    admin: Admin,
    limit = 100
): Promise<{ expired: number; companyIds: string[] }> {
    const { data, error } = await admin.rpc("rpc_expire_due_trials", {
        p_limit: limit,
    });
    if (error) {
        throw new Error(error.message);
    }
    const row = (data ?? {}) as { expired?: number; company_ids?: unknown };
    const ids = Array.isArray(row.company_ids)
        ? row.company_ids.filter((id): id is string => typeof id === "string")
        : [];
    return {
        expired: Number(row.expired ?? 0),
        companyIds: ids,
    };
}

export async function markAbandonedDue(admin: Admin): Promise<{
    marked: number;
    companyIds: string[];
}> {
    const { data, error } = await admin.rpc("rpc_mark_abandoned_due");
    if (error) {
        throw new Error(error.message);
    }
    const row = (data ?? {}) as { marked?: number; company_ids?: unknown };
    const ids = Array.isArray(row.company_ids)
        ? row.company_ids.filter((id): id is string => typeof id === "string")
        : [];
    return {
        marked: Number(row.marked ?? 0),
        companyIds: ids,
    };
}
