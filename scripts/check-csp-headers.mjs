#!/usr/bin/env node
/**
 * S10/S11 — confere CSP enforce + X-Frame-Options no HTTP (sem DevTools).
 * Uso: npm run check:csp
 *      npm run check:csp -- https://app.renthus.com.br/login
 *      CSP_CHECK_URL=http://localhost:3000/login npm run check:csp
 */
import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(path.join(process.cwd(), "package.json"));
const { assertCspResponseHeaders } = requireCjs("./lib/security/assertCspHeaders.cjs");

const url =
    process.argv[2] ||
    process.env.CSP_CHECK_URL ||
    "https://app.renthus.com.br/login";

const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
});

const errors = assertCspResponseHeaders(res.headers);
if (errors.length) {
    console.error(`[check-csp] ${url} → HTTP ${res.status}`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}

const csp = res.headers.get("content-security-policy") ?? "";
const nonce = csp.match(/nonce-([^']+)/)?.[1] ?? "?";
console.log(
    `[check-csp] OK ${url} HTTP ${res.status} nonce=${nonce.slice(0, 8)}… X-Frame-Options=DENY`
);
