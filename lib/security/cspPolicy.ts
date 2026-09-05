/**
 * Content-Security-Policy (S10 enforce).
 *
 * Com `nonce`: script-src nonce + strict-dynamic (guia Next.js / Context7).
 * Sem nonce: fallback só para testes / headers estáticos — o proxy sempre envia nonce.
 * style-src mantém 'unsafe-inline' (Tailwind / Radix). Mixpanel e Sentry são bundle.
 */

export type CspBuildOpts = {
    isDev?: boolean;
    nonce?: string;
    /** S15: ingest Sentry `/api/{project}/security/` — omitir se DSN vazio. */
    reportUri?: string;
};

export const CSP_ENFORCE_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const X_FRAME_OPTIONS_DENY = "DENY";
export const X_NONCE_HEADER = "x-nonce";

export function buildContentSecurityPolicy(opts: CspBuildOpts = {}): string {
    const isDev = Boolean(opts.isDev);
    const nonce = opts.nonce?.trim() ?? "";
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
            "https://api-js.mixpanel.com",
            "https://api.mixpanel.com",
        ].join(" "),
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
    ];

    const reportUri = opts.reportUri?.trim() ?? "";
    if (reportUri) {
        directives.push(`report-uri ${reportUri}`);
        directives.push("report-to csp-endpoint");
    }

    return directives.join("; ");
}
