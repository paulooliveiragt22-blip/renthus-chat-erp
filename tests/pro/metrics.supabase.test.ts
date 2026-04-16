import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMetricsAdapter } from "../../src/pro/adapters/metrics/metrics.supabase";

describe("SupabaseMetricsAdapter", () => {
    it("insere linha quando companyId está nas tags", async () => {
        let insertCalled = false;
        const insertSpy = async (payload: unknown) => {
            insertCalled = true;
            assert.deepEqual(payload, {
                company_id: "550e8400-e29b-41d4-a716-446655440000",
                thread_id: "t1",
                metric_name: "pro_pipeline.test",
                value: 2,
                tags: { reason: "ai_timeout" },
            });
            return { error: null };
        };
        const adminSpy = {
            from: (table: string) => {
                assert.equal(table, "pro_pipeline_metric_events");
                return { insert: insertSpy };
            },
        } as unknown as SupabaseClient;

        let innerArgs: unknown[] = [];
        const m = new SupabaseMetricsAdapter(adminSpy, {
            increment: (...a: unknown[]) => {
                innerArgs = a;
            },
            timing: () => {},
        });

        const companyId = "550e8400-e29b-41d4-a716-446655440000";
        m.increment("pro_pipeline.test", 2, { companyId, threadId: "t1", reason: "ai_timeout" });

        assert.deepEqual(innerArgs, ["pro_pipeline.test", 2, { companyId, threadId: "t1", reason: "ai_timeout" }]);

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });

        assert.equal(insertCalled, true);
    });

    it("não insere sem companyId", async () => {
        let insertCalls = 0;
        const adminSpy = {
            from: () => ({
                insert: async () => {
                    insertCalls += 1;
                    return { error: null };
                },
            }),
        } as unknown as SupabaseClient;
        const m = new SupabaseMetricsAdapter(adminSpy, {
            increment: () => {},
            timing: () => {},
        });
        m.increment("pro_pipeline.test", 1, { reason: "x" });

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });

        assert.equal(insertCalls, 0);
    });
});
