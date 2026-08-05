import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildHighValueConfirmMessage,
    parseHighValueConfirmPolicy,
} from "../../lib/billing/aiWallet";
import {
    isPortugueseOrderConfirmation,
    isPortugueseOrderRejection,
} from "../../lib/chatbot/pro/confirmationPt";

describe("high-value confirm (legado)", () => {
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

    it("botões WhatsApp de confirmar/cancelar são reconhecidos no legado", () => {
        assert.equal(isPortugueseOrderConfirmation("confirmar_pedido"), true);
        assert.equal(isPortugueseOrderConfirmation("CONFIRMAR"), true);
        assert.equal(isPortugueseOrderRejection("cancelar_pedido"), true);
        assert.equal(isPortugueseOrderConfirmation("cancelar_pedido"), false);
    });
});
