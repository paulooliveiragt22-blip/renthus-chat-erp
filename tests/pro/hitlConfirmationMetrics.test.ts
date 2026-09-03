import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MetricsPort } from "../../src/pro/ports/metrics.port";
import { tryResolvePendingOrderConfirmation } from "../../src/pro/pipeline/resolvePendingOrderConfirmation";

type MetricCall = { name: string; tags?: Record<string, string> };

function fakeMetrics(): MetricsPort & { calls: MetricCall[] } {
    const calls: MetricCall[] = [];
    return {
        calls,
        increment(name, _value?, tags?) {
            calls.push({ name, tags });
        },
        timing() {},
    };
}

/** Admin mínimo: claim + updates + persist outbound sem Graph real. */
function fakeAdmin(claim: {
    id: string;
    draft: unknown;
    created_at: string;
    customer_id: string;
}) {
    return {
        from: (_table: string) => {
            const api: Record<string, unknown> = {};
            api.update = () => api;
            api.insert = async () => ({ error: null });
            api.eq = () => api;
            api.select = () => api;
            api.maybeSingle = async () => ({ data: claim, error: null });
            return api;
        },
    };
}

describe("HITL hitl_confirmation metrics (C1.6)", () => {
    it("cancel → action=cancel", async () => {
        const metrics = fakeMetrics();
        const handled = await tryResolvePendingOrderConfirmation({
            admin: fakeAdmin({
                id: "c1",
                draft: {},
                created_at: new Date().toISOString(),
                customer_id: "cust",
            }) as never,
            companyId: "co",
            threadId: "th",
            phoneE164: "+5500000000000",
            messageId: "m1",
            inboundText: "pro_cancel_order",
            metrics,
        });

        assert.equal(handled, true);
        const hit = metrics.calls.find((c) => c.name === "pro_pipeline.hitl_confirmation");
        assert.ok(hit);
        assert.equal(hit?.tags?.action, "cancel");
    });

    it("expired → action=expired", async () => {
        const metrics = fakeMetrics();
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const handled = await tryResolvePendingOrderConfirmation({
            admin: fakeAdmin({
                id: "c1",
                draft: {},
                created_at: old,
                customer_id: "cust",
            }) as never,
            companyId: "co",
            threadId: "th",
            phoneE164: "+5500000000000",
            messageId: "m1",
            inboundText: "pro_confirm_order",
            metrics,
        });

        assert.equal(handled, true);
        const hit = metrics.calls.find((c) => c.name === "pro_pipeline.hitl_confirmation");
        assert.equal(hit?.tags?.action, "expired");
    });
});
