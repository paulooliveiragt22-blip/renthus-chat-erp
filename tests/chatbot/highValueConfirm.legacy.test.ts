import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildHighValueConfirmMessage,
    parseHighValueConfirmPolicy,
} from "../../lib/billing/aiWallet";

describe("high-value confirm", () => {
    it("parseHighValueConfirmPolicy exige toggle + limiar > 0", () => {
        assert.deepEqual(parseHighValueConfirmPolicy({}), { enabled: false, amountBrl: 0 });
        assert.deepEqual(
            parseHighValueConfirmPolicy({
                high_value_confirm_enabled: true,
                high_value_confirm_amount_brl: 0,
            }),
            { enabled: false, amountBrl: 0 }
        );
        assert.deepEqual(
            parseHighValueConfirmPolicy({
                high_value_confirm_enabled: true,
                high_value_confirm_amount_brl: 150,
            }),
            { enabled: true, amountBrl: 150 }
        );
    });

    it("buildHighValueConfirmMessage pede segunda confirmação", () => {
        const msg = buildHighValueConfirmMessage(200, 150);
        assert.match(msg, /CONFIRMAR/);
        assert.match(msg, /R\$\s*200/);
        assert.match(msg, /R\$\s*150/);
    });
});
