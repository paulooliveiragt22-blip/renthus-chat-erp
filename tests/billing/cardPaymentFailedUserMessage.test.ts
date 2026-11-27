import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(process.cwd(), "lib/billing/pagarme.ts"), "utf8");

describe("cardPaymentFailedUserMessage", () => {
    it("delega a recusa para a frase do cliente", () => {
        assert.match(src, /export function cardPaymentFailedUserMessage/);
        assert.match(src, /customerCardDeclineMessage/);
        assert.match(src, /acquirer_return_code/);
        assert.equal(src.includes("4000000000000010"), false);
        assert.equal(src.includes("números de teste do sandbox"), false);
    });
});
