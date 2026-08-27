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
    plans: () => platformFetch<{ plans: unknown[] }>("/api/platform/plans"),
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
    metrics: (kind: "dashboard" | "queue" | "pipeline", minutes?: number) => {
        const q = new URLSearchParams({ kind });
        if (minutes != null) q.set("minutes", String(minutes));
        return platformFetch<unknown>(`/api/platform/metrics?${q}`);
    },
    securityOps: () => platformFetch<unknown>("/api/platform/security/ops-status"),
    audit: (offset = 0, limit = 50) =>
        platformFetch<{ rows: unknown[]; total: number }>(
            `/api/platform/audit?offset=${offset}&limit=${limit}`
        ),
    users: () => platformFetch<{ users: unknown[] }>("/api/platform/users"),
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
    healthExtended: () => platformFetch<unknown>("/api/platform/health/extended"),
    startImpersonation: (company_id: string, reason: string) =>
        platformFetch<{ ok: boolean; sessionId: string }>("/api/platform/impersonate", {
            method: "POST",
            body: JSON.stringify({ company_id, reason }),
        }),
    endImpersonation: () =>
        platformFetch<{ ok: boolean }>("/api/platform/impersonate", { method: "DELETE" }),
};
