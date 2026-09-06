/** Cookie + helpers for platform → tenant read-only impersonation. */

export const PLATFORM_IMPERSONATION_COOKIE = "platform_impersonation";
export const PLATFORM_IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1h

export type ImpersonationSessionRow = {
    id: string;
    platform_user_id: string;
    company_id: string;
    reason: string;
    started_at: string;
    expires_at: string;
    ended_at: string | null;
};

export function isImpersonationActive(row: ImpersonationSessionRow | null | undefined): boolean {
    if (!row || row.ended_at) return false;
    const exp = new Date(row.expires_at).getTime();
    return Number.isFinite(exp) && exp > Date.now();
}

/**
 * Tenant API paths blocked for mutating verbs while impersonating (A3).
 * Deny-by-default sob `/api/*` tenant — exceções = ingresso público/máquina/auth.
 */
export function isTenantMutationPath(pathname: string): boolean {
    if (!pathname.startsWith("/api/")) return false;

    // Ingresso público / máquina / auth — não são mutação de tenant via sessão
    if (pathname.startsWith("/api/platform/")) return false;
    if (pathname.startsWith("/api/auth/")) return false;
    if (pathname.startsWith("/api/health")) return false;
    if (pathname.startsWith("/api/public/")) return false;
    if (pathname.startsWith("/api/whatsapp/incoming")) return false;
    if (pathname.startsWith("/api/meta/")) return false;
    if (pathname.startsWith("/api/billing/webhook")) return false;
    if (pathname.startsWith("/api/billing/signup")) return false;
    if (pathname.startsWith("/api/billing/public-plans")) return false;
    if (pathname.startsWith("/api/billing/trial-policy")) return false;
    if (pathname.startsWith("/api/agent/")) return false;
    if (pathname.startsWith("/api/print/")) return false;
    if (pathname.startsWith("/api/ativar")) return false;
    if (pathname.startsWith("/api/onboarding")) return false;
    if (pathname.startsWith("/api/debug/")) return false;

    return true;
}

export function isMutatingHttpMethod(method: string): boolean {
    const m = method.toUpperCase();
    return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}
