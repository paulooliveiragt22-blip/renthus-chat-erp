import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripLegacyProContextKeys } from "../../src/pro/adapters/supabase/session.repository.supabase";

describe("stripLegacyProContextKeys", () => {
    it("remove chaves do motor PRO legado e preserva o resto", () => {
        const out = stripLegacyProContextKeys({
            ai_order_canonical: { items: [] },
            pro_anthropic_messages: [{ role: "user" }],
            pro_misunderstanding_streak: 3,
            pro_escalation_tier: 1,
            __pro_v2_state: { step: "pro_idle" },
            flow_token: "abc",
        });

        assert.equal("ai_order_canonical" in out, false);
        assert.equal("pro_anthropic_messages" in out, false);
        assert.equal("pro_misunderstanding_streak" in out, false);
        assert.equal("pro_escalation_tier" in out, false);
        assert.deepEqual(out.__pro_v2_state, { step: "pro_idle" });
        assert.equal(out.flow_token, "abc");
    });
});
