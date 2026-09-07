import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(process.cwd(), "lib/billing/pagarme.ts"), "utf8");

describe("cardPaymentFailedUserMessage", () => {
    it("diferencia live vs sandbox e prioriza acquirer_message", () => {
        assert.match(src, /export function cardPaymentFailedUserMessage/);
        assert.match(src, /acquirer_message/);
        assert.match(src, /_test_/);
        assert.match(src, /cartão real/i);
        assert.match(src, /4000000000000010/);
    });
});
