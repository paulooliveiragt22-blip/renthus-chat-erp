/**
 * S15 — URL de CSP report do Sentry a partir do DSN público (NEXT_PUBLIC_SENTRY_DSN).
 * A public key no query é o mesmo identificador do DSN; não é o auth token.
 */

export const CSP_REPORT_TO_GROUP = "csp-endpoint";

export function sentrySecurityReportUrl(dsn: string | undefined | null): string | null {
    const raw = dsn?.trim();
    if (!raw) return null;
    try {
        const u = new URL(raw);
        const key = u.username.trim();
        const project = u.pathname.replace(/^\//, "").split("/")[0]?.trim() ?? "";
        if (!key || !project || !/^\d+$/.test(project)) return null;
        return `${u.protocol}//${u.host}/api/${project}/security/?sentry_key=${encodeURIComponent(key)}`;
    } catch {
        return null;
    }
}

export function buildCspReportToHeader(reportUrl: string): string {
    return JSON.stringify({
        group: CSP_REPORT_TO_GROUP,
        max_age: 10886400,
        endpoints: [{ url: reportUrl }],
        include_subdomains: true,
    });
}

export function buildReportingEndpointsHeader(reportUrl: string): string {
    return `${CSP_REPORT_TO_GROUP}="${reportUrl}"`;
}
