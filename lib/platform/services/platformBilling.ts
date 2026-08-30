import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformOpsAuditCtx } from "./platformOps";

/**
 * Lista assinaturas canônicas (pagarme_subscriptions) com JOINs para a UI
 * do super admin. Inclui dados de pagamento (status, trial, próxima cobrança,
 * última fatura) que a tabela legada subscriptions não tinha.
 */
export async function listSubscriptions(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("pagarme_subscriptions")
        .select(`
            id, company_id, plan_id, plan, plan_key, status, allow_overage,
            started_at, ended_at, trial_ends_at, last_paid_at, next_billing_at, activated_at,
            companies ( id, name, slug, is_active ),
            plans ( id, key, name, price_cents )
        `)
        .order("started_at", { ascending: false, nullsFirst: false });

    if (error) throw new Error(error.message);

    const subs = (data ?? []) as Array<{
        id: string;
        company_id: string;
        [k: string]: unknown;
    }>;

    // Enriquecer com a última fatura de cada empresa (1 round-trip via IN)
    const companyIds = subs.map((s) => s.company_id);
    let invoiceByCompany: Record<
        string,
        {
            id: string;
            amount: number;
            status: string;
            due_at: string;
            paid_at: string | null;
        }
    > = {};

    if (companyIds.length > 0) {
        const { data: inv, error: invErr } = await admin
            .from("invoices")
            .select("id, company_id, amount, status, due_at, paid_at, created_at")
            .in("company_id", companyIds)
            .order("created_at", { ascending: false });

        if (invErr) throw new Error(invErr.message);

        for (const row of inv ?? []) {
            const cid = (row as { company_id: string }).company_id;
            if (!invoiceByCompany[cid]) {
                invoiceByCompany[cid] = {
                    id: (row as { id: string }).id,
                    amount: Number((row as { amount: unknown }).amount),
                    status: (row as { status: string }).status,
                    due_at: (row as { due_at: string }).due_at,
                    paid_at: (row as { paid_at: string | null }).paid_at,
                };
            }
        }
    }

    return subs.map((s) => ({
        ...s,
        last_invoice: invoiceByCompany[s.company_id] ?? null,
    }));
}

export async function changeSubscriptionPlan(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    subscriptionId: string,
    planKey: string,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_change_subscription_plan", {
        p_subscription_id: subscriptionId,
        p_plan_key: planKey,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function setSubscriptionOverage(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    subscriptionId: string,
    allowOverage: boolean,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_set_subscription_overage", {
        p_subscription_id: subscriptionId,
        p_allow_overage: allowOverage,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}
