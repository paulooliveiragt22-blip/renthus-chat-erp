import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import {
    buildContentSecurityPolicy,
    CSP_ENFORCE_HEADER,
    CSP_REPORT_ONLY_HEADER,
    X_FRAME_OPTIONS_DENY,
} from "../../lib/security/cspPolicy";

const requireCjs = createRequire(path.join(process.cwd(), "package.json"));
const cjs = requireCjs("./lib/security/cspPolicy.cjs") as {
    buildContentSecurityPolicy: (opts?: { isDev?: boolean; nonce?: string }) => string;
    CSP_ENFORCE_HEADER: string;
    CSP_REPORT_ONLY_HEADER: string;
    X_FRAME_OPTIONS_DENY: string;
};

describe("cspPolicy", () => {
    it("header names e X-Frame-Options DENY (S11)", () => {
        assert.equal(CSP_ENFORCE_HEADER, "Content-Security-Policy");
        assert.equal(CSP_REPORT_ONLY_HEADER, "Content-Security-Policy-Report-Only");
        assert.equal(X_FRAME_OPTIONS_DENY, "DENY");
        assert.equal(cjs.CSP_ENFORCE_HEADER, CSP_ENFORCE_HEADER);
        assert.equal(cjs.X_FRAME_OPTIONS_DENY, "DENY");
    });

    it("prod sem nonce: sem unsafe-eval; frame-ancestors none", () => {
        const csp = buildContentSecurityPolicy({ isDev: false });
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /https:\/\/\*\.supabase\.co/);
        assert.doesNotMatch(csp, /unsafe-eval/);
        assert.equal(cjs.buildContentSecurityPolicy({ isDev: false }), csp);
    });

    it("prod com nonce: strict-dynamic, sem unsafe-inline em script-src", () => {
        const csp = buildContentSecurityPolicy({ isDev: false, nonce: "abc123" });
        assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
        assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
        assert.equal(cjs.buildContentSecurityPolicy({ isDev: false, nonce: "abc123" }), csp);
    });

    it("dev: unsafe-eval; TS e CJS iguais", () => {
        const csp = buildContentSecurityPolicy({ isDev: true, nonce: "devn" });
        assert.match(csp, /unsafe-eval/);
        assert.match(csp, /nonce-devn/);
        assert.equal(cjs.buildContentSecurityPolicy({ isDev: true, nonce: "devn" }), csp);
    });
});
