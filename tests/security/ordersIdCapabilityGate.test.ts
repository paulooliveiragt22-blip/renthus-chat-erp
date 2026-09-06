import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("B6 orders/[id] capability gate", () => {
    const src = readFileSync(join(process.cwd(), "app/api/orders/[id]/route.ts"), "utf8");

    it("cookie path exige orders.read; não usa só requireCompanyAccess", () => {
        assert.match(src, /requireCapability\("orders\.read"\)/);
        assert.doesNotMatch(src, /requireCompanyAccess\(\)/);
    });

    it("não faz select * em orders; agent tem projeção própria", () => {
        assert.doesNotMatch(src, /\.select\(\s*["']\*/);
        assert.match(src, /ORDER_SELECT_AGENT/);
        assert.match(src, /verifyAgentByApiKey/);
    });
});
