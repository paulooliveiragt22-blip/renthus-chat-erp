/** Cookie + helpers for platform → tenant read-only impersonation. */

export const PLATFORM_IMPERSONATION_COOKIE = "platform_impersonation";

/** B8: sessão curta (30 min) — suporte não fica com cookie longo. */
export const PLATFORM_IMPERSONATION_TTL_MS = 30 * 60 * 1000;

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

export function isImpersonationExpired(row: ImpersonationSessionRow | null | undefined): boolean {
    if (!row || row.ended_at) return false;
    const exp = new Date(row.expires_at).getTime();
    return Number.isFinite(exp) && exp <= Date.now();
}

/** Máscara PII leve em leituras sob impersonation (B8). */
export function maskPhoneForImpersonation(phone: string | null | undefined): string | null {
    if (phone == null) return null;
    const raw = String(phone).trim();
    if (!raw) return null;
    const digits = raw.replaceAll(/\D/g, "");
    if (digits.length <= 4) return "***";
    return `***${digits.slice(-4)}`;
}

export function maskEmailForImpersonation(email: string | null | undefined): string | null {
    if (email == null) return null;
    const raw = String(email).trim();
    if (!raw || !raw.includes("@")) return raw ? "***" : null;
    const [user, domain] = raw.split("@");
    const u = user ?? "";
    const visible = u.slice(0, Math.min(2, u.length));
    return `${visible}***@${domain}`;
}

/**
 * Tenant API paths blocked for mutating verbs while impersonating (A3).
 * Deny-by-default sob `/api/*` tenant — exceções = ingresso público/máquina/auth.
 */
export function isTenantMutationPath(pathname: string): boolean {
    if (!pathname.startsWith("/api/")) return false;

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
