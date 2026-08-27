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

/** Tenant API paths blocked for mutating verbs while impersonating. */
export function isTenantMutationPath(pathname: string): boolean {
    return (
        pathname.startsWith("/api/admin/") ||
        pathname.startsWith("/api/workspace/select") ||
        pathname.startsWith("/api/billing/") ||
        pathname.startsWith("/api/companies/")
    );
}

export function isMutatingHttpMethod(method: string): boolean {
    const m = method.toUpperCase();
    return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}
