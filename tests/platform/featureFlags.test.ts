import assert from "node:assert";
import { describe, it } from "node:test";
import { isValidFeatureFlagKey } from "../../lib/platform/featureFlagKey";

describe("platform feature flag key validation", () => {
    it("accepts dotted keys", () => {
        assert.strictEqual(isValidFeatureFlagKey("chatbot.outbound_paused"), true);
        assert.strictEqual(isValidFeatureFlagKey("billing.enforce_plan_gates"), true);
    });

    it("rejects invalid keys", () => {
        assert.strictEqual(isValidFeatureFlagKey(""), false);
        assert.strictEqual(isValidFeatureFlagKey("Bad"), false);
        assert.strictEqual(isValidFeatureFlagKey("1start"), false);
        assert.strictEqual(isValidFeatureFlagKey("has space"), false);
    });
});
