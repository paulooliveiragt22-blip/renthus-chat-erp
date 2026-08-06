import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PipelineTurnTraceSchema } from "@/src/domain/contracts/pipelineTurnTrace";
import { isPipelineTurnTraceEnabled } from "@/lib/pro/recordPipelineTurnTrace";

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
        assert.equal(isPipelineTurnTraceEnabled({} as NodeJS.ProcessEnv), false);
        assert.equal(
            isPipelineTurnTraceEnabled({ PRO_PIPELINE_TURN_TRACE: "1" } as NodeJS.ProcessEnv),
            true
        );
        assert.equal(
            isPipelineTurnTraceEnabled({ PRO_PIPELINE_TURN_TRACE: "false" } as NodeJS.ProcessEnv),
            false
        );
    });
});
