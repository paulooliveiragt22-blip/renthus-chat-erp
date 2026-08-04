import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplacePollResult } from "@/src/types/contracts.marketplace-orders";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import { ifoodOrdersAdapter } from "../adapters/ifood/ifoodOrders.adapter";
import { importMarketplaceOrder } from "./importMarketplaceOrder";

export async function pollAndImportIfoodOrders(
    admin: SupabaseClient,
    companyId: string
): Promise<MarketplacePollResult> {
    const { data: conn } = await admin
        .from("marketplace_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "ifood")
        .maybeSingle();

    if (!conn) {
        return {
            ok: false,
            provider: "ifood",
            events: 0,
            imported: 0,
            skipped: 0,
            errors: 0,
            message: "Conexão iFood não configurada.",
        };
    }

    const useMock = Boolean(conn.use_mock);
    const accessToken =
        decryptCredential(conn.encrypted_access_token as string | null) ??
        (useMock ? "mock" : "");

    const events = await ifoodOrdersAdapter.pollEvents({
        accessToken,
        merchantId: String(conn.merchant_id ?? ""),
        useMock: useMock || !accessToken || accessToken === "mock",
    });

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const ackIds: string[] = [];

    for (const ev of events) {
        ackIds.push(ev.eventId);
        const code = String(ev.code).toUpperCase();
        // PLACED / PLC — novo pedido
        if (code !== "PLC" && code !== "PLACED" && !code.includes("PLACED")) {
            skipped += 1;
            continue;
        }

        const external = await ifoodOrdersAdapter.fetchOrder({
            accessToken,
            externalOrderId: ev.orderId,
            useMock: useMock || !accessToken || accessToken === "mock",
        });
        if (!external) {
            errors += 1;
            continue;
        }

        const result = await importMarketplaceOrder(admin, companyId, "ifood", external);
        if (!result.ok) {
            errors += 1;
            continue;
        }
        if (result.created) imported += 1;
        else skipped += 1;

        // Auto-confirm no iFood quando ERP não exige aprovação
        const { data: settings } = await admin
            .from("company_settings")
            .select("require_order_approval")
            .eq("company_id", companyId)
            .maybeSingle();
        if (!settings?.require_order_approval) {
            const conf = await ifoodOrdersAdapter.confirmOrder({
                accessToken,
                externalOrderId: ev.orderId,
                useMock: useMock || !accessToken || accessToken === "mock",
            });
            if (conf.ok) {
                await admin
                    .from("marketplace_external_orders")
                    .update({
                        last_pushed_status: "CONFIRMED",
                        external_status: "CONFIRMED",
                        updated_at: new Date().toISOString(),
                    })
                    .eq("company_id", companyId)
                    .eq("provider", "ifood")
                    .eq("external_order_id", ev.orderId);
            }
        }
    }

    await ifoodOrdersAdapter.acknowledgeEvents({
        accessToken,
        eventIds: ackIds,
        useMock: useMock || !accessToken || accessToken === "mock",
    });

    return {
        ok: errors === 0,
        provider: "ifood",
        events: events.length,
        imported,
        skipped,
        errors,
        message:
            events.length === 0
                ? "Nenhum evento novo."
                : `Eventos ${events.length}: ${imported} importados, ${skipped} ignorados, ${errors} erros.`,
    };
}
