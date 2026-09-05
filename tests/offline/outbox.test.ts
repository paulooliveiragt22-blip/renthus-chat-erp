import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOfflineCommand } from "../../lib/offline/domain/OfflineCommand";
import {
    canEnqueueCommand,
    getDefaultSyncEligibilityLimits,
    isCommandTypeAllowed,
} from "../../lib/offline/domain/SyncEligibility";
import { getConflictPolicy } from "../../lib/offline/domain/ConflictPolicy";
import { createMemoryOutboxStore } from "../../lib/offline/adapters/memoryOutboxStore";
import { createMockSyncTransport } from "../../lib/offline/adapters/httpSyncTransport";
import { enqueueCommand } from "../../lib/offline/application/enqueueCommand";
import { flushOutbox } from "../../lib/offline/application/flushOutbox";
import { resolveConflict } from "../../lib/offline/application/resolveConflict";
import { shouldPersistOfflineQuery } from "../../lib/offline/persistQueryAllowlist";

describe("offline SyncEligibility", () => {
    it("permite noop e bloqueia FinalizePdvSale em P0", () => {
        assert.equal(isCommandTypeAllowed("noop"), true);
        assert.equal(isCommandTypeAllowed("FinalizePdvSale"), false);
    });

    it("rejeita type_not_allowed e queue_full", () => {
        const base = createOfflineCommand({
            type: "FinalizePdvSale",
            companyId: "co-1",
        });
        const denied = canEnqueueCommand(base, 0);
        assert.equal(denied.ok, false);
        if (!denied.ok) {
            assert.equal(denied.reason, "type_not_allowed");
        }

        const noop = createOfflineCommand({ type: "noop", companyId: "co-1" });
        const limits = { ...getDefaultSyncEligibilityLimits(), maxPendingCommands: 1 };
        const full = canEnqueueCommand(noop, 1, limits);
        assert.equal(full.ok, false);
        if (!full.ok) assert.equal(full.reason, "queue_full");
    });
});

describe("offline ConflictPolicy", () => {
    it("default reject_reopen; FinalizePdvSale reject_reopen", () => {
        assert.equal(getConflictPolicy("FinalizePdvSale"), "reject_reopen");
        assert.equal(getConflictPolicy("unknown_type"), "reject_reopen");
        assert.equal(getConflictPolicy("noop"), "server_wins");
    });
});

describe("offline outbox memory + flush batch", () => {
    it("enqueue + flush em lote marca synced", async () => {
        const store = createMemoryOutboxStore();
        const a = await enqueueCommand(store, { type: "noop", companyId: "co-1", payload: { n: 1 } });
        const b = await enqueueCommand(store, { type: "noop", companyId: "co-1", payload: { n: 2 } });
        assert.equal(a.ok, true);
        assert.equal(b.ok, true);
        assert.equal(await store.countPending("co-1"), 2);

        const transport = createMockSyncTransport((req) => ({
            results: req.commands.map((c) => ({
                clientMutationId: c.clientMutationId,
                outcome: "synced" as const,
            })),
        }));

        const result = await flushOutbox(store, transport, { companyId: "co-1", batchSize: 20 });
        assert.equal(result.attempted, 2);
        assert.equal(result.synced, 2);
        assert.equal(result.notImplemented, false);
        assert.equal(await store.countPending("co-1"), 0);
    });

    it("flush com notImplemented marca failed e para", async () => {
        const store = createMemoryOutboxStore();
        await enqueueCommand(store, { type: "noop", companyId: "co-1" });
        const transport = createMockSyncTransport((req) => ({
            notImplemented: true,
            results: req.commands.map((c) => ({
                clientMutationId: c.clientMutationId,
                outcome: "failed" as const,
                error: "offline_sync_not_implemented",
            })),
        }));
        const result = await flushOutbox(store, transport, { companyId: "co-1" });
        assert.equal(result.notImplemented, true);
        assert.equal(result.failed, 1);
        const rows = await store.list({ companyId: "co-1" });
        assert.equal(rows[0]?.status, "failed");
    });

    it("rejeita tipo fora da allowlist no enqueue", async () => {
        const store = createMemoryOutboxStore();
        const r = await enqueueCommand(store, {
            type: "FinalizePdvSale",
            companyId: "co-1",
        });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "type_not_allowed");
    });
});

describe("offline resolveConflict + persist allowlist", () => {
    it("resolveConflict usa política do tipo", () => {
        const r = resolveConflict(
            { type: "FinalizePdvSale" },
            { clientMutationId: "x", outcome: "conflict", error: "stock" }
        );
        assert.equal(r.resolution, "reject_reopen");
        assert.match(r.message, /stock/);
    });

    it("shouldPersistOfflineQuery só catálogo/PDV", () => {
        assert.equal(shouldPersistOfflineQuery(["pdv-catalog", "co-1"]), true);
        assert.equal(shouldPersistOfflineQuery(["offline-catalog"]), true);
        assert.equal(shouldPersistOfflineQuery(["platform", "billing"]), false);
        assert.equal(shouldPersistOfflineQuery("pdv-catalog"), false);
    });
});
