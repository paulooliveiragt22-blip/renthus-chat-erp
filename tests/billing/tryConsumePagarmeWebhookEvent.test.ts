import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    STALE_PROCESSING_MS,
    isWebhookEventReclaimable,
} from "@/lib/billing/tryConsumePagarmeWebhookEvent";

describe("isWebhookEventReclaimable", () => {
    const now = Date.parse("2026-09-04T12:00:00.000Z");

    it("failed_retryable sempre reclaimable", () => {
        assert.equal(
            isWebhookEventReclaimable("failed_retryable", "2026-09-04T11:59:00.000Z", now),
            true
        );
    });

    it("processing fresco → não reclaim", () => {
        assert.equal(
            isWebhookEventReclaimable("processing", "2026-09-04T11:55:00.000Z", now),
            false
        );
    });

    it("processing stale → reclaim", () => {
        const staleAt = new Date(now - STALE_PROCESSING_MS - 1).toISOString();
        assert.equal(isWebhookEventReclaimable("processing", staleAt, now), true);
    });

    it("completed / failed_permanent → não", () => {
        assert.equal(isWebhookEventReclaimable("completed", null, now), false);
        assert.equal(isWebhookEventReclaimable("failed_permanent", null, now), false);
    });
});
