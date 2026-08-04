import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceProvider, MarketplaceSyncResult } from "@/src/types/contracts.marketplace";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import { aiqfomeCatalogAdapter } from "../adapters/aiqfome/aiqfomeCatalog.adapter";
import { syncIfoodCatalogForCompany } from "./syncIfoodCatalog";
import { syncCatalogFromSnapshot } from "./syncCatalogCore";

export async function syncMarketplaceCatalogForCompany(
    admin: SupabaseClient,
    companyId: string,
    provider: MarketplaceProvider
): Promise<MarketplaceSyncResult> {
    if (provider === "ifood") {
        return syncIfoodCatalogForCompany(admin, companyId);
    }

    const finishedAt = new Date().toISOString();
    const empty = {
        created: 0,
        updated: 0,
        skipped: 0,
        imagesDownloaded: 0,
        errors: 0,
    };

    const { data: conn, error: connErr } = await admin
        .from("marketplace_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "aiqfome")
        .maybeSingle();

    if (connErr || !conn) {
        return {
            ok: false,
            provider: "aiqfome",
            counters: empty,
            finishedAt,
            errorMessage: "Conexão Aiqfome não configurada.",
        };
    }

    await admin
        .from("marketplace_connections")
        .update({ status: "syncing", last_error: null, updated_at: finishedAt })
        .eq("id", conn.id);

    try {
        const accessToken =
            decryptCredential(conn.encrypted_access_token as string | null) ?? "mock";
        const snapshot = await aiqfomeCatalogAdapter.fetchCatalog({
            companyId,
            merchantId: String(conn.merchant_id ?? ""),
            accessToken,
            useMock: true,
        });
        const result = await syncCatalogFromSnapshot(admin, companyId, "aiqfome", snapshot);
        await admin
            .from("marketplace_connections")
            .update({
                status: result.ok ? "connected" : "error",
                last_sync_at: finishedAt,
                last_sync_created: result.counters.created,
                last_sync_updated: result.counters.updated,
                last_sync_skipped: result.counters.skipped,
                last_sync_images: result.counters.imagesDownloaded,
                last_sync_errors: result.counters.errors,
                last_error: result.errorMessage,
                updated_at: finishedAt,
            })
            .eq("id", conn.id);
        return { ...result, finishedAt };
    } catch (err) {
        const message = err instanceof Error ? err.message : "sync_failed";
        await admin
            .from("marketplace_connections")
            .update({ status: "error", last_error: message, updated_at: new Date().toISOString() })
            .eq("id", conn.id);
        return {
            ok: false,
            provider: "aiqfome",
            counters: empty,
            finishedAt: new Date().toISOString(),
            errorMessage: message,
        };
    }
}
