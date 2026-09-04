import assert from "node:assert";
import { describe, it } from "node:test";
import {
    extractWebhookOrderId,
    webhookConsumeKey,
} from "../../lib/billing/webhookIdempotencyKey";

describe("webhookConsumeKey", () => {
    it("prefers event.id", () => {
        assert.strictEqual(
            webhookConsumeKey("evt_1", "order.paid", "or_9"),
            "evt_1"
        );
    });

    it("falls back to pge:{orderId} (shared across event types)", () => {
        assert.strictEqual(
            webhookConsumeKey(null, "order.paid", "or_abc"),
            "pge:or_abc"
        );
        assert.strictEqual(
            webhookConsumeKey("  ", "charge.paid", "or_abc"),
            "pge:or_abc"
        );
    });

    it("returns null without stable key", () => {
        assert.strictEqual(webhookConsumeKey(null, "order.paid", null), null);
        assert.strictEqual(webhookConsumeKey(undefined, "", ""), null);
    });
});

describe("extractWebhookOrderId", () => {
    it("reads order.paid data.id", () => {
        assert.strictEqual(
            extractWebhookOrderId("order.paid", { id: "or_1" }),
            "or_1"
        );
    });

    it("reads charge.paid nested order.id", () => {
        assert.strictEqual(
            extractWebhookOrderId("charge.paid", { order: { id: "or_2" } }),
            "or_2"
        );
        assert.strictEqual(
            extractWebhookOrderId("charge.paid", { order_id: "or_3" }),
            "or_3"
        );
    });
});
