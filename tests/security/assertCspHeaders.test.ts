import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { buildContentSecurityPolicy, X_FRAME_OPTIONS_DENY } from "../../lib/security/cspPolicy";

const requireCjs = createRequire(path.join(process.cwd(), "package.json"));
const { assertCspResponseHeaders } = requireCjs("./lib/security/assertCspHeaders.cjs") as {
    assertCspResponseHeaders: (headers: { get: (name: string) => string | null }) => string[];
};

function headersFrom(map: Record<string, string | null>) {
    return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("assertCspResponseHeaders (check:csp)", () => {
    it("aceita policy enforce com nonce + DENY", () => {
        const csp = buildContentSecurityPolicy({ isDev: false, nonce: "abc+" });
        const errors = assertCspResponseHeaders(
            headersFrom({
                "content-security-policy": csp,
                "x-frame-options": X_FRAME_OPTIONS_DENY,
            })
        );
        assert.deepEqual(errors, []);
    });

    it("rejeita Report-Only, SAMEORIGIN e script-src sem nonce", () => {
        const errors = assertCspResponseHeaders(
            headersFrom({
                "content-security-policy-report-only": "default-src 'self'",
                "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
                "x-frame-options": "SAMEORIGIN",
            })
        );
        assert.ok(errors.some((e) => /Report-Only/.test(e)));
        assert.ok(errors.some((e) => /nonce/.test(e)));
        assert.ok(errors.some((e) => /DENY/.test(e)));
    });
});
