import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceProvider } from "@/src/types/contracts.marketplace";
import { isCatalogSyncDue, clampCatalogSyncIntervalHours } from "./catalogSyncSchedule";
import { syncMarketplaceCatalogForCompany } from "./syncMarketplaceCatalog";

export type MarketplaceCatalogCronResult = {
    scanned: number;
    due: number;
    synced: number;
    skipped: number;
    errors: Array<{ companyId: string; provider: string; message: string }>;
};

const DEFAULT_BATCH = 4;

type ConnRow = {
    id: string;
    company_id: string;
    provider: string;
    status: string;
    last_sync_at: string | null;
    sync_interval_hours: number | null;
    use_mock?: boolean | null;
};

/**
 * Cron F4.1: sincroniza catálogo das conexões com auto_sync_enabled,
 * respeitando intervalo 1–6h e pulando status syncing/disconnected.
 */
export async function runMarketplaceCatalogCron(
    admin: SupabaseClient,
    opts?: { now?: Date; batchSize?: number }
): Promise<MarketplaceCatalogCronResult> {
    const now = opts?.now ?? new Date();
    const batchSize = Math.max(1, Math.min(20, opts?.batchSize ?? DEFAULT_BATCH));
    const result: MarketplaceCatalogCronResult = {
        scanned: 0,
        due: 0,
        synced: 0,
        skipped: 0,
        errors: [],
    };

    const { data, error } = await admin
        .from("marketplace_connections")
        .select("id, company_id, provider, status, last_sync_at, sync_interval_hours, use_mock")
        .eq("auto_sync_enabled", true)
        .eq("use_mock", false)
        .in("status", ["connected", "error"])
        .order("last_sync_at", { ascending: true, nullsFirst: true })
        .limit(40);

    if (error) {
        result.errors.push({
            companyId: "",
            provider: "",
            message: error.message,
        });
        return result;
    }

    const rows = (data ?? []) as ConnRow[];
    result.scanned = rows.length;

    const dueRows = rows.filter((row) =>
        isCatalogSyncDue({
            lastSyncAt: row.last_sync_at,
            intervalHours: clampCatalogSyncIntervalHours(row.sync_interval_hours),
            now,
        })
    );
    result.due = dueRows.length;
    result.skipped = rows.length - dueRows.length;

    const toRun = dueRows.slice(0, batchSize);
    result.skipped += Math.max(0, dueRows.length - toRun.length);

    for (const row of toRun) {
        const provider = row.provider as MarketplaceProvider;
        if (provider !== "ifood" && provider !== "aiqfome") {
            result.errors.push({
                companyId: row.company_id,
                provider: row.provider,
                message: "provider_unsupported",
            });
            continue;
        }
        try {
            const sync = await syncMarketplaceCatalogForCompany(
                admin,
                row.company_id,
                provider
            );
            if (sync.ok) {
                result.synced += 1;
            } else {
                result.errors.push({
                    companyId: row.company_id,
                    provider,
                    message: sync.errorMessage ?? "sync_failed",
                });
            }
        } catch (err) {
            result.errors.push({
                companyId: row.company_id,
                provider,
                message: err instanceof Error ? err.message : "sync_failed",
            });
        }
    }

    return result;
}
