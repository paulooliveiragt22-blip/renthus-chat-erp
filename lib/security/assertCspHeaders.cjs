/**
 * Asserções HTTP de CSP enforce (S10) + X-Frame-Options DENY (S11).
 * Usado por `scripts/check-csp-headers.mjs` e testes.
 */
"use strict";

/**
 * @param {{ get: (name: string) => string | null }} headers
 * @returns {string[]}
 */
function assertCspResponseHeaders(headers) {
    const csp = headers.get("content-security-policy") ?? "";
    const reportOnly = headers.get("content-security-policy-report-only");
    const xfo = (headers.get("x-frame-options") ?? "").toUpperCase();
    const errors = [];
    if (reportOnly) {
        errors.push("Content-Security-Policy-Report-Only ainda presente (S10 = enforce só)");
    }
    if (!csp) {
        errors.push("Content-Security-Policy ausente");
    } else {
        if (!/script-src 'self' 'nonce-[^']+'/.test(csp)) {
            errors.push("script-src sem nonce");
        }
        if (!/strict-dynamic/.test(csp)) {
            errors.push("falta 'strict-dynamic'");
        }
        if (!/frame-ancestors 'none'/.test(csp)) {
            errors.push("falta frame-ancestors 'none'");
        }
        if (/script-src[^;]*unsafe-inline/.test(csp)) {
            errors.push("script-src ainda tem unsafe-inline (não deve com nonce)");
        }
    }
    if (xfo !== "DENY") {
        errors.push(`X-Frame-Options deve ser DENY (S11), veio ${xfo || "(vazio)"}`);
    }
    return errors;
}

module.exports = { assertCspResponseHeaders };
