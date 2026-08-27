import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformOpsAuditCtx } from "./platformOps";

export async function listSubscriptions(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("subscriptions")
        .select(`
            id, company_id, plan_id, status, allow_overage, started_at, ended_at,
            companies ( id, name, slug, is_active ),
            plans ( id, key, name, price_cents )
        `)
        .order("started_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
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
