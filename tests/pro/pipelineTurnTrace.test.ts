import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PipelineTurnTraceSchema } from "@/src/domain/contracts/pipelineTurnTrace";
import {
    isPipelineTurnTraceEnabled,
    recordPipelineTurnTrace,
} from "@/lib/pro/recordPipelineTurnTrace";
import type { ProSessionState } from "@/src/types/contracts";

function idleState(): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

describe("pipeline turn trace", () => {
    it("Zod aceita shape v1 com outbound live", () => {
        const parsed = PipelineTurnTraceSchema.parse({
            v: 1,
            companyId: "11111111-1111-4111-8111-111111111111",
            threadId: "22222222-2222-4222-8222-222222222222",
            channel: "instagram",
            inboundMessageId: "wamid.abc",
            stateBefore: { step: "pro_idle" },
            stateAfter: { step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Oi" }, { kind: "buttons", text: "Escolha" }],
            draftSnapshot: null,
            telemetryReason: null,
            aiProfile: "avancado",
            createdAt: "2026-08-06T12:00:00.000Z",
        });
        assert.equal(parsed.v, 1);
        assert.equal(parsed.outbound.length, 2);
    });

    it("flag PRO_PIPELINE_TURN_TRACE só liga com 1/true/on", () => {
        assert.equal(isPipelineTurnTraceEnabled({}), false);
        assert.equal(isPipelineTurnTraceEnabled({ PRO_PIPELINE_TURN_TRACE: "1" }), true);
        assert.equal(isPipelineTurnTraceEnabled({ PRO_PIPELINE_TURN_TRACE: "false" }), false);
    });

    it("C4.1 — com flag ligada, upsert em pipeline_turn_traces (mock)", async () => {
        const prev = process.env.PRO_PIPELINE_TURN_TRACE;
        process.env.PRO_PIPELINE_TURN_TRACE = "1";
        try {
            const upserted: { row: Record<string, unknown>; opts: unknown }[] = [];
            const admin = {
                from(table: string) {
                    assert.equal(table, "pipeline_turn_traces");
                    return {
                        upsert(row: Record<string, unknown>, opts: unknown) {
                            upserted.push({ row, opts });
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            } as unknown as SupabaseClient;

            await recordPipelineTurnTrace({
                admin,
                tenant: {
                    companyId: "11111111-1111-4111-8111-111111111111",
                    threadId: "22222222-2222-4222-8222-222222222222",
                    messageId: "wamid.c4-trace",
                    phoneE164: "+5511999999999",
                },
                stateBefore: idleState(),
                stateAfter: { ...idleState(), step: "pro_collecting_order" },
                outbound: [{ kind: "text", text: "Oi" }],
                aiProfile: "avancado",
                telemetryReason: null,
            });

            assert.equal(upserted.length, 1);
            assert.equal(upserted[0]!.row.inbound_message_id, "wamid.c4-trace");
            assert.equal(upserted[0]!.row.v, 1);
            assert.deepEqual(upserted[0]!.opts, {
                onConflict: "company_id,inbound_message_id",
            });
        } finally {
            if (prev === undefined) delete process.env.PRO_PIPELINE_TURN_TRACE;
            else process.env.PRO_PIPELINE_TURN_TRACE = prev;
        }
    });

    it("C4.1 — com flag off, não grava", async () => {
        const prev = process.env.PRO_PIPELINE_TURN_TRACE;
        delete process.env.PRO_PIPELINE_TURN_TRACE;
        try {
            let called = false;
            const admin = {
                from() {
                    called = true;
                    return { upsert: async () => ({ error: null }) };
                },
            } as unknown as SupabaseClient;

            await recordPipelineTurnTrace({
                admin,
                tenant: {
                    companyId: "11111111-1111-4111-8111-111111111111",
                    threadId: "22222222-2222-4222-8222-222222222222",
                    messageId: "wamid.no-trace",
                    phoneE164: "+5511999999999",
                },
                stateBefore: idleState(),
                stateAfter: idleState(),
                outbound: [],
            });
            assert.equal(called, false);
        } finally {
            if (prev === undefined) delete process.env.PRO_PIPELINE_TURN_TRACE;
            else process.env.PRO_PIPELINE_TURN_TRACE = prev;
        }
    });
});
