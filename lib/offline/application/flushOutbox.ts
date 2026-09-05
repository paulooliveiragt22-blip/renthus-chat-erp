import type { OfflineCommand } from "../domain/OfflineCommand";
import type { OutboxStore } from "../ports/OutboxStore";
import {
    DEFAULT_FLUSH_BATCH_SIZE,
    type SyncTransport,
} from "../ports/SyncTransport";
import { notifySyncStatusChanged } from "../syncStatusStore";

export type FlushOutboxOptions = {
    companyId: string;
    batchSize?: number;
    signal?: AbortSignal;
};

export type FlushOutboxResult = {
    attempted: number;
    synced: number;
    failed: number;
    conflict: number;
    notImplemented: boolean;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drain ordenado em lotes (Perf-3). P0: com mock ou API 501 — sem mutação real.
 */
export async function flushOutbox(
    store: OutboxStore,
    transport: SyncTransport,
    options: FlushOutboxOptions
): Promise<FlushOutboxResult> {
    const batchSize = options.batchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    const summary: FlushOutboxResult = {
        attempted: 0,
        synced: 0,
        failed: 0,
        conflict: 0,
        notImplemented: false,
    };

    let backoffMs = 0;
    // Loop até esvaziar flushable ou batch vazio / notImplemented
    for (;;) {
        if (options.signal?.aborted) break;

        const pending = await store.list({
            companyId: options.companyId,
            statuses: ["pending"],
            limit: batchSize,
        });
        const batch = pending.filter((c) => c.status === "pending");
        if (batch.length === 0) break;

        if (backoffMs > 0) {
            await sleep(backoffMs);
        }

        for (const cmd of batch) {
            await store.updateStatus(cmd.id, "syncing", {
                attempts: cmd.attempts + 1,
            });
        }
        notifySyncStatusChanged();

        const response = await transport.sendBatch(
            { companyId: options.companyId, commands: batch },
            options.signal
        );

        if (response.notImplemented) {
            summary.notImplemented = true;
        }

        const byMutation = new Map(
            response.results.map((r) => [r.clientMutationId, r] as const)
        );

        for (const cmd of batch) {
            summary.attempted += 1;
            const result = byMutation.get(cmd.clientMutationId);
            if (!result) {
                await store.updateStatus(cmd.id, "failed", {
                    lastError: "missing_sync_result",
                });
                summary.failed += 1;
                continue;
            }
            if (result.outcome === "synced") {
                await store.updateStatus(cmd.id, "synced", { lastError: null });
                summary.synced += 1;
            } else if (result.outcome === "conflict") {
                await store.updateStatus(cmd.id, "conflict", {
                    lastError: result.error ?? "conflict",
                });
                summary.conflict += 1;
            } else {
                await store.updateStatus(cmd.id, "failed", {
                    lastError: result.error ?? "sync_failed",
                });
                summary.failed += 1;
            }
        }
        notifySyncStatusChanged();

        if (response.notImplemented) break;

        // Backoff leve entre lotes se houve falhas; failed não reentra neste flush (só pending).
        if (summary.failed > 0 || summary.conflict > 0) {
            backoffMs = Math.min(backoffMs === 0 ? 250 : backoffMs * 2, 4_000);
        } else {
            backoffMs = 0;
        }

        if (batch.length < batchSize) break;
    }

    return summary;
}

export type { OfflineCommand };
