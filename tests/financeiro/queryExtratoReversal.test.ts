import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("queryExtrato reversal", () => {
    it("omite journals reversed e trata reversal como saída", () => {
        const src = readFileSync(
            join(process.cwd(), "src/financeiro/application/queryExtrato.ts"),
            "utf8"
        );
        assert.match(src, /row\.status === "reversed"\) continue/);
        assert.match(src, /isReversal.*source_type === "reversal"/s);
        assert.match(src, /type: isExpense \? "expense"/);
        assert.match(src, /isReversal \? Math\.abs\(rawAmount\)/);
        assert.equal(/estornado \(total\)/.test(src), false);
    });
});
