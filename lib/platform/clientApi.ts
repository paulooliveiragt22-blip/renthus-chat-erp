/** Client-side fetch helpers for /platform UI (never import server-only code). */

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(
            typeof body.error === "string" ? body.error : `HTTP ${res.status}`
        ) as Error & { code?: string; status?: number };
        err.code = body.code;
        err.status = res.status;
        throw err;
    }
    return body as T;
}

export type PlatformDashboardStats = {
    totalCompanies: number;
    ordersThisMonth: number;
    revenueThisMonth: number;
    activeChannels: number;
};

export type PlatformQueueCompanyRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    oldestPendingAgeSec: number;
    done15m: number;
    failed15m: number;
    coalesced15m: number;
    processed15m: number;
    failureRate: number;
    dedupHitRate: number;
    severity: "green" | "yellow" | "red" | string;
};

export type PlatformQueueHealth = {
    periodMinutes: number;
    summary: {
        pendingNow: number;
        processed15m: number;
        failed15m: number;
        coalesced15m: number;
        oldestPendingAgeSec: number;
        failureRate: number;
        dedupHitRate: number;
    };
    companies: PlatformQueueCompanyRow[];
};

export type PlatformPipelineRow = {
    companyId: string;
    companyName: string;
    metricName: string;
    reason: string | null;
    intent: string | null;
    errorCode: string | null;
    provider: string | null;
    total: number;
};

export type PlatformPipelineHealth = {
    periodMinutes: number;
    volume: number;
    rows: PlatformPipelineRow[];
};

export type PlatformSecurityOps = {
    vercelEnv: string | null;
    nodeEnv: string;
    isProd: boolean;
    checks: Array<{
        key: string;
        label: string;
        ok: boolean;
        hint: string;
    }>;
};

export type PlatformUserRow = {
    id: string;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    mfa_required: boolean;
    last_login_at: string | null;
    created_at: string;
};

export type PlatformFeatureFlagOverride = {
    id: string;
    company_id: string;
    key: string;
    enabled: boolean;
    companies?: { id: string; name: string; slug: string | null } | null;
};

export type PlatformFeatureFlag = {
    key: string;
    description: string;
    enabled_global: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    overrides?: PlatformFeatureFlagOverride[];
};

export const platformApi = {
    me: () => platformFetch<{ user: unknown; mfa: unknown }>("/api/platform/me"),
    mfaStatus: () =>
        platformFetch<{ satisfied: boolean; required: boolean; currentLevel: string | null }>(
            "/api/platform/auth/mfa/status"
        ),
    companies: () => platformFetch<{ companies: unknown[] }>("/api/platform/companies"),
    createCompany: (data: Record<string, unknown>) =>
        platformFetch<{ id: string }>("/api/platform/companies", {
            method: "POST",
            body: JSON.stringify(data),
        }),
    company: (id: string) => platformFetch<unknown>(`/api/platform/companies/${id}`),
    updateCompany: (id: string, data: Record<string, unknown>) =>
        platformFetch<{ ok: boolean }>(`/api/platform/companies/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    suspendCompany: (id: string, reason: string) =>
        platformFetch<{ ok: boolean }>(`/api/platform/companies/${id}/suspend`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        }),
    reactivateCompany: (id: string, reason: string) =>
        platformFetch<{ ok: boolean }>(`/api/platform/companies/${id}/reactivate`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        }),
    plans: () =>
        platformFetch<{
            plans: Array<{ id: string; key: string; name: string; price_cents: number }>;
        }>("/api/platform/plans"),
    channels: () => platformFetch<{ channels: unknown[] }>("/api/platform/channels"),
    createChannel: (data: Record<string, unknown>) =>
        platformFetch<{ ok: boolean }>("/api/platform/channels", {
            method: "POST",
            body: JSON.stringify(data),
        }),
    updateChannel: (id: string, data: Record<string, unknown>) =>
        platformFetch<{ ok: boolean }>(`/api/platform/channels/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    updateChannelCredentials: (id: string, data: Record<string, unknown>) =>
        platformFetch<{ ok: boolean }>(`/api/platform/channels/${id}/credentials`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    updateSubscription: (id: string, data: Record<string, unknown>) =>
        platformFetch<{ ok: boolean }>(`/api/platform/subscriptions/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    orders: (page = 0, limit = 50) =>
        platformFetch<{ orders: unknown[]; total: number }>(
            `/api/platform/orders?page=${page}&limit=${limit}`
        ),
    metrics: ((kind: "dashboard" | "queue" | "pipeline", minutes?: number) => {
        const q = new URLSearchParams({ kind });
        if (minutes != null) q.set("minutes", String(minutes));
        if (kind === "dashboard") {
            return platformFetch<PlatformDashboardStats>(`/api/platform/metrics?${q}`);
        }
        if (kind === "queue") {
            return platformFetch<PlatformQueueHealth>(`/api/platform/metrics?${q}`);
        }
        return platformFetch<PlatformPipelineHealth>(`/api/platform/metrics?${q}`);
    }) as {
        (kind: "dashboard", minutes?: number): Promise<PlatformDashboardStats>;
        (kind: "queue", minutes?: number): Promise<PlatformQueueHealth>;
        (kind: "pipeline", minutes?: number): Promise<PlatformPipelineHealth>;
    },
    securityOps: () => platformFetch<PlatformSecurityOps>("/api/platform/security/ops-status"),
    audit: (offset = 0, limit = 50) =>
        platformFetch<{
            rows: Array<{
                id: string;
                occurred_at: string;
                actor_email: string | null;
                actor_role: string | null;
                action: string;
                resource_type: string;
                resource_id: string | null;
                company_id: string | null;
                outcome: string;
            }>;
            total: number;
        }>(`/api/platform/audit?offset=${offset}&limit=${limit}`),
    users: () => platformFetch<{ users: PlatformUserRow[] }>("/api/platform/users"),
    inviteUser: (data: { email: string; display_name: string; role: string }) =>
        platformFetch<{
            ok: boolean;
            platformUserId: string;
            authUserId: string;
            invited: boolean;
        }>("/api/platform/users/invite", {
            method: "POST",
            body: JSON.stringify(data),
        }),
    featureFlags: () =>
        platformFetch<{ flags: PlatformFeatureFlag[] }>("/api/platform/feature-flags"),
    upsertFeatureFlag: (data: {
        key: string;
        description?: string;
        enabled_global: boolean;
        metadata?: Record<string, unknown>;
    }) =>
        platformFetch<{ flag: PlatformFeatureFlag }>("/api/platform/feature-flags", {
            method: "PUT",
            body: JSON.stringify(data),
        }),
    setFeatureFlagOverride: (data: {
        key: string;
        company_id: string;
        enabled: boolean;
    }) =>
        platformFetch<{ override: PlatformFeatureFlagOverride }>(
            "/api/platform/feature-flags/overrides",
            { method: "PUT", body: JSON.stringify(data) }
        ),
    deleteFeatureFlagOverride: (id: string) =>
        platformFetch<{ ok: boolean }>(
            `/api/platform/feature-flags/overrides?id=${encodeURIComponent(id)}`,
            { method: "DELETE" }
        ),
    billingSubscriptions: () =>
        platformFetch<{ subscriptions: unknown[] }>("/api/platform/billing/subscriptions"),
    changePlan: (id: string, plan_key: string, reason = "") =>
        platformFetch<{ ok: boolean }>(
            `/api/platform/billing/subscriptions/${id}/change-plan`,
            { method: "POST", body: JSON.stringify({ plan_key, reason }) }
        ),
    allowOverage: (id: string, allow_overage: boolean, reason = "") =>
        platformFetch<{ ok: boolean }>(
            `/api/platform/billing/subscriptions/${id}/allow-overage`,
            { method: "POST", body: JSON.stringify({ allow_overage, reason }) }
        ),
    healthExtended: () =>
        platformFetch<{
            ok: boolean;
            db: string;
            latencyMs: number;
            queue: {
                pendingNow: number;
                failed15m: number;
                failureRate: number;
                oldestPendingAgeSec: number;
            } | null;
            security: {
                isProd: boolean;
                checksOk: number;
                checksTotal: number;
                failing: string[];
            };
        }>("/api/platform/health/extended"),
    startImpersonation: (company_id: string, reason: string) =>
        platformFetch<{ ok: boolean; sessionId: string }>("/api/platform/impersonate", {
            method: "POST",
            body: JSON.stringify({ company_id, reason }),
        }),
    endImpersonation: () =>
        platformFetch<{ ok: boolean }>("/api/platform/impersonate", { method: "DELETE" }),
};
