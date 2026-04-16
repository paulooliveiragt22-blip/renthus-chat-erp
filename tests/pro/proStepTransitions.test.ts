import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyAiStateTransition,
    canTransition,
    executeOrderRpcTransition,
    INVALID_PRO_STEP_TRANSITION,
    resolveStepAfterAiAction,
    resolveStepAfterOrderStage,
} from "../../src/pro/pipeline/proStepTransitions";
import type { ProSessionState } from "../../src/types/contracts";

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
        if (!r.ok) assert.equal(r.reason, INVALID_PRO_STEP_TRANSITION);
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

    it("applyAiStateTransition atualiza streak e tier de escalonamento", () => {
        const base: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 1,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
        };

        const unknown = applyAiStateTransition({
            state: base,
            action: "reply",
            intentMarker: "unknown",
        });
        assert.equal(unknown.misunderstandingStreak, 2);
        assert.equal(unknown.escalationTier, 0);

        const ok = applyAiStateTransition({
            state: unknown,
            action: "reply",
            intentMarker: "ok",
        });
        assert.equal(ok.misunderstandingStreak, 0);

        const escalated = applyAiStateTransition({
            state: ok,
            action: "escalate",
            intentMarker: "unknown",
        });
        assert.equal(escalated.step, "pro_escalation_choice");
        assert.equal(escalated.misunderstandingStreak, 0);
        assert.equal(escalated.escalationTier, 1);
    });
});
