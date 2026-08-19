import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("queryExtrato reversal sign", () => {
    it("trata source_type reversal como saída com valor absoluto", () => {
        const src = readFileSync(
            join(process.cwd(), "src/financeiro/application/queryExtrato.ts"),
            "utf8"
        );
        assert.match(src, /isReversal.*source_type === "reversal"/s);
        assert.match(src, /type: isExpense \? "expense"/);
        assert.match(src, /isReversal \? Math\.abs\(rawAmount\)/);
        assert.match(src, /statusLabel[\s\S]*estornado/);
    });
});
