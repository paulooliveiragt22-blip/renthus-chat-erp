import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import { ifoodOrdersAdapter } from "../adapters/ifood/ifoodOrders.adapter";

/**
 * Espelha status Renthus → iFood:
 * - confirmed / new (após aprovação) → confirm
 * - delivered → dispatch
 */
export async function pushMarketplaceOrderStatus(
    admin: SupabaseClient,
    companyId: string,
    orderId: string,
    newStatus: string
): Promise<{ ok: boolean; message?: string }> {
    const { data: link } = await admin
        .from("marketplace_external_orders")
        .select("*")
        .eq("company_id", companyId)
        .eq("order_id", orderId)
        .maybeSingle();

    if (!link) return { ok: true, message: "not_marketplace_order" };
    if (link.provider !== "ifood") {
        return { ok: true, message: "provider_status_push_pending" };
    }

    const { data: conn } = await admin
        .from("marketplace_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "ifood")
        .maybeSingle();

    if (!conn) return { ok: false, message: "connection_missing" };

    const useMock = Boolean(conn.use_mock);
    const accessToken =
        decryptCredential(conn.encrypted_access_token as string | null) ??
        (useMock ? "mock" : "");

    const st = String(newStatus).toLowerCase();
    const externalOrderId = String(link.external_order_id);

    if (st === "new" || st === "confirmed" || st === "preparing") {
        if (link.last_pushed_status === "CONFIRMED" || link.last_pushed_status === "DISPATCHED") {
            return { ok: true, message: "already_confirmed" };
        }
        const res = await ifoodOrdersAdapter.confirmOrder({
            accessToken,
            externalOrderId,
            useMock: useMock || !accessToken || accessToken === "mock",
        });
        if (!res.ok) return { ok: false, message: res.error };
        await admin
            .from("marketplace_external_orders")
            .update({
                last_pushed_status: "CONFIRMED",
                external_status: "CONFIRMED",
                updated_at: new Date().toISOString(),
            })
            .eq("id", link.id);
        return { ok: true, message: "confirmed" };
    }

    if (st === "delivered") {
        const res = await ifoodOrdersAdapter.dispatchOrder({
            accessToken,
            externalOrderId,
            useMock: useMock || !accessToken || accessToken === "mock",
        });
        if (!res.ok) return { ok: false, message: res.error };
        await admin
            .from("marketplace_external_orders")
            .update({
                last_pushed_status: "DISPATCHED",
                external_status: "DISPATCHED",
                updated_at: new Date().toISOString(),
            })
            .eq("id", link.id);
        return { ok: true, message: "dispatched" };
    }

    return { ok: true, message: "no_op" };
}
