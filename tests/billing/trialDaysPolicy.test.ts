import assert from "node:assert";
import { describe, it } from "node:test";
import {
    clampTrialDays,
    parseTrialDaysEnv,
    TRIAL_DAYS_MAX,
    TRIAL_DAYS_MIN,
} from "../../lib/billing/trialDaysPolicy";

describe("trialDaysPolicy", () => {
    it("clampTrialDays accepts 0..90", () => {
        assert.strictEqual(clampTrialDays(0), 0);
        assert.strictEqual(clampTrialDays(90), 90);
        assert.strictEqual(clampTrialDays(-5), TRIAL_DAYS_MIN);
        assert.strictEqual(clampTrialDays(100), TRIAL_DAYS_MAX);
        assert.strictEqual(clampTrialDays("7"), 7);
        assert.strictEqual(clampTrialDays("x"), 0);
    });

    it("parseTrialDaysEnv defaults to 0", () => {
        assert.strictEqual(parseTrialDaysEnv(undefined), 0);
        assert.strictEqual(parseTrialDaysEnv(""), 0);
        assert.strictEqual(parseTrialDaysEnv("15"), 15);
    });
});
