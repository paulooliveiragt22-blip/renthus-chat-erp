import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import {
    buildContentSecurityPolicy,
    CSP_REPORT_ONLY_HEADER,
} from "../../lib/security/cspPolicy";

const requireCjs = createRequire(path.join(process.cwd(), "package.json"));
const cjs = requireCjs("./lib/security/cspPolicy.cjs") as {
    buildContentSecurityPolicy: (opts?: { isDev?: boolean }) => string;
    CSP_REPORT_ONLY_HEADER: string;
};

describe("cspPolicy", () => {
    it("Report-Only header name estável", () => {
        assert.equal(CSP_REPORT_ONLY_HEADER, "Content-Security-Policy-Report-Only");
        assert.equal(cjs.CSP_REPORT_ONLY_HEADER, CSP_REPORT_ONLY_HEADER);
    });

    it("prod: sem unsafe-eval; com frame-ancestors none e connect-src allowlist", () => {
        const csp = buildContentSecurityPolicy({ isDev: false });
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /https:\/\/\*\.supabase\.co/);
        assert.doesNotMatch(csp, /unsafe-eval/);
        assert.equal(cjs.buildContentSecurityPolicy({ isDev: false }), csp);
    });

    it("dev: unsafe-eval para Next HMR; TS e CJS iguais", () => {
        const csp = buildContentSecurityPolicy({ isDev: true });
        assert.match(csp, /unsafe-eval/);
        assert.equal(cjs.buildContentSecurityPolicy({ isDev: true }), csp);
    });
});
