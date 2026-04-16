import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    canTransition,
    executeOrderRpcTransition,
    resolveStepAfterAiAction,
    resolveStepAfterOrderStage,
} from "../../src/pro/pipeline/proStepTransitions";

describe("proStepTransitions (R1)", () => {
    it("transições de IA a partir de passos operacionais", () => {
        assert.equal(
            resolveStepAfterAiAction("pro_collecting_order", "request_confirmation"),
            "pro_awaiting_confirmation"
        );
        assert.equal(resolveStepAfterAiAction("pro_idle", "escalate"), "pro_escalation_choice");
        assert.equal(resolveStepAfterAiAction("pro_awaiting_confirmation", "reply"), "pro_collecting_order");
        assert.equal(resolveStepAfterAiAction("pro_escalation_choice", "error"), "pro_collecting_order");
    });

    it("rejeita IA em handover", () => {
        const r = canTransition("handover", { type: "ai_action_resolved", action: "reply" });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "invalid_state_transition");
        assert.equal(resolveStepAfterAiAction("handover", "reply"), "pro_collecting_order");
    });

    it("transições de order_stage só a partir de pro_awaiting_confirmation", () => {
        assert.equal(resolveStepAfterOrderStage("pro_awaiting_confirmation", "order_created_ok"), "pro_idle");
        assert.equal(
            resolveStepAfterOrderStage("pro_awaiting_confirmation", "gate_no_draft"),
            "pro_collecting_order"
        );
        const bad = canTransition("pro_idle", {
            type: "order_stage",
            outcome: "order_created_ok",
        });
        assert.equal(bad.ok, false);
        assert.equal(resolveStepAfterOrderStage("pro_idle", "order_created_ok"), "pro_idle");
    });

    it("intent human_handover leva a handover", () => {
        const r = canTransition("pro_collecting_order", { type: "intent_human_handover" });
        assert.ok(r.ok && r.to === "handover");
    });

    it("executeOrderRpcTransition só executa RPC em awaiting_confirmation", async () => {
        let calls = 0;
        const skipped = await executeOrderRpcTransition({
            from: "pro_collecting_order",
            runCreateFromDraft: async () => {
                calls += 1;
                return {
                    ok: true,
                    orderId: "o1",
                    customerMessage: "ok",
                    requireApproval: false,
                };
            },
        });
        assert.equal(calls, 0);
        assert.equal(skipped.executed, false);

        const executed = await executeOrderRpcTransition({
            from: "pro_awaiting_confirmation",
            runCreateFromDraft: async () => {
                calls += 1;
                return {
                    ok: true,
                    orderId: "o2",
                    customerMessage: "ok",
                    requireApproval: false,
                };
            },
        });
        assert.equal(calls, 1);
        assert.equal(executed.executed, true);
        assert.equal(executed.nextStep, "pro_idle");
    });
});
