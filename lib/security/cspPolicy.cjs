/**
 * CommonJS espelho de `cspPolicy.ts` — `next.config.js` não transpila TS.
 * Teste `cspPolicy.test.ts` trava drift TS↔CJS.
 */
"use strict";

const CSP_ENFORCE_HEADER = "Content-Security-Policy";
const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
const X_FRAME_OPTIONS_DENY = "DENY";
const X_NONCE_HEADER = "x-nonce";

function buildContentSecurityPolicy(opts) {
    const isDev = Boolean(opts && opts.isDev);
    const nonce = opts && typeof opts.nonce === "string" ? opts.nonce.trim() : "";
    const scriptSrc = nonce
        ? `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`
        : isDev
          ? "'self' 'unsafe-inline' 'unsafe-eval'"
          : "'self' 'unsafe-inline'";

    const directives = [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data: https:",
        "font-src 'self' data:",
        [
            "connect-src 'self'",
            "https://*.supabase.co",
            "wss://*.supabase.co",
            "https://*.sentry.io",
            "https://*.ingest.sentry.io",
            "https://api.pagar.me",
            "https://api.pagarme.com",
            "https://graph.facebook.com",
            "https://graph.instagram.com",
            "https://www.facebook.com",
            "https://web.facebook.com",
            "https://connect.facebook.net",
            "https://api-js.mixpanel.com",
            "https://api.mixpanel.com",
        ].join(" "),
        "frame-src https://www.facebook.com https://web.facebook.com",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
    ];

    const reportUri = opts && typeof opts.reportUri === "string" ? opts.reportUri.trim() : "";
    if (reportUri) {
        directives.push(`report-uri ${reportUri}`);
        directives.push("report-to csp-endpoint");
    }

    return directives.join("; ");
}

module.exports = {
    CSP_ENFORCE_HEADER,
    CSP_REPORT_ONLY_HEADER,
    X_FRAME_OPTIONS_DENY,
    X_NONCE_HEADER,
    buildContentSecurityPolicy,
};
