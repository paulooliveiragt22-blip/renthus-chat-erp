/**
 * Content-Security-Policy (Report-Only na P2).
 *
 * Fonte única usada por `next.config.js` (via `cspPolicy.cjs`) e testes.
 * Docs: Next.js App Router CSP guide (Context7 `/vercel/next.js`) —
 * `headers()` sem nonce exige `'unsafe-inline'` em script/style; nonce +
 * `strict-dynamic` fica para a fase enforce no `proxy.ts`.
 */

export type CspBuildOpts = {
    isDev?: boolean;
};

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

export function buildContentSecurityPolicy(opts: CspBuildOpts = {}): string {
    const isDev = Boolean(opts.isDev);
    const scriptSrc = isDev
        ? "'self' 'unsafe-inline' 'unsafe-eval' https://cdn.mxpnl.com"
        : "'self' 'unsafe-inline' https://cdn.mxpnl.com";

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
            "https://api-js.mixpanel.com",
            "https://api.mixpanel.com",
            "https://cdn.mxpnl.com",
        ].join(" "),
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
    ];

    return directives.join("; ");
}
