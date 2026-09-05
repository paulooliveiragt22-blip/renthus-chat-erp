import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContentSecurityPolicy } from "../../lib/security/cspPolicy";
import {
    buildCspReportToHeader,
    buildReportingEndpointsHeader,
    CSP_REPORT_TO_GROUP,
    sentrySecurityReportUrl,
} from "../../lib/security/sentryCspReport";

const FIXTURE_DSN = "https://abc123public@o99.ingest.sentry.io/555";

describe("sentryCspReport (S15)", () => {
    it("monta /security/ a partir do DSN público", () => {
        assert.equal(
            sentrySecurityReportUrl(FIXTURE_DSN),
            "https://o99.ingest.sentry.io/api/555/security/?sentry_key=abc123public"
        );
        assert.equal(sentrySecurityReportUrl(""), null);
        assert.equal(sentrySecurityReportUrl("not-a-url"), null);
    });

    it("policy + headers Report-To", () => {
        const reportUri = sentrySecurityReportUrl(FIXTURE_DSN);
        assert.ok(reportUri);
        const csp = buildContentSecurityPolicy({
            isDev: false,
            nonce: "n1",
            reportUri,
        });
        assert.match(csp, /report-uri https:\/\/o99\.ingest\.sentry\.io\/api\/555\/security\//);
        assert.match(csp, /report-to csp-endpoint/);
        assert.match(buildCspReportToHeader(reportUri), /csp-endpoint/);
        assert.equal(
            buildReportingEndpointsHeader(reportUri),
            `${CSP_REPORT_TO_GROUP}="${reportUri}"`
        );
    });
});
