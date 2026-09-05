import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCspContext } from "../../lib/security/cspProxy";

describe("createCspContext (S10)", () => {
    it("nonce único e policy enforce com strict-dynamic", () => {
        const a = createCspContext(false);
        const b = createCspContext(false);
        assert.notEqual(a.nonce, b.nonce);
        assert.match(a.value, new RegExp(`nonce-${a.nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        assert.match(a.value, /strict-dynamic/);
        assert.match(a.value, /frame-ancestors 'none'/);
        assert.doesNotMatch(a.value, /script-src[^;]*unsafe-inline/);
    });
});
