import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    clampCatalogSyncIntervalHours,
    isCatalogSyncDue,
} from "../../src/marketplaces/services/catalogSyncSchedule";

describe("catalogSyncSchedule", () => {
    it("clampa intervalo entre 1 e 6", () => {
        assert.equal(clampCatalogSyncIntervalHours(0), 1);
        assert.equal(clampCatalogSyncIntervalHours(3), 3);
        assert.equal(clampCatalogSyncIntervalHours(9), 6);
        assert.equal(clampCatalogSyncIntervalHours("2"), 2);
        assert.equal(clampCatalogSyncIntervalHours(null), 3);
    });

    it("considera due quando nunca sincronizou", () => {
        assert.equal(
            isCatalogSyncDue({ lastSyncAt: null, intervalHours: 3, now: new Date() }),
            true
        );
    });

    it("respeita intervalo em horas", () => {
        const now = new Date("2026-08-04T12:00:00.000Z");
        assert.equal(
            isCatalogSyncDue({
                lastSyncAt: "2026-08-04T10:00:00.000Z",
                intervalHours: 3,
                now,
            }),
            false
        );
        assert.equal(
            isCatalogSyncDue({
                lastSyncAt: "2026-08-04T09:00:00.000Z",
                intervalHours: 3,
                now,
            }),
            true
        );
    });
});
