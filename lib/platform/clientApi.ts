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
    ordersCount?: number;
    revenue?: number;
    revenueNote?: string | null;
};

export type PlatformOrdersListResponse = {
    orders: Array<{
        id: string;
        total_amount: number | null;
        status: string;
        payment_method: string | null;
        created_at: string;
        source?: string | null;
        company_id?: string;
        companies?: { id: string; name: string } | null;
    }>;
    total: number;
    ordersCount: number;
    revenue: number;
};

export type PlatformQueueCompanyRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    processingNow?: number;
    backlogTotal?: number;
    oldestPendingAgeSec: number;
    done15m?: number;
    failed15m: number;
    coalesced15m?: number;
    doneWindow?: number;
    failedWindow?: number;
    coalescedWindow?: number;
    processed15m: number;
    processedWindow?: number;
    failureRate: number;
    dedupHitRate: number;
    severity: "green" | "yellow" | "red" | string;
};

export type PlatformQueueHealth = {
    periodMinutes: number;
    summary: {
        pendingNow: number;
        processingNow?: number;
        backlogTotal?: number;
        processed15m: number;
        processedWindow?: number;
        failed15m: number;
        failedWindow?: number;
        coalesced15m: number;
        coalescedWindow?: number;
        oldestPendingAgeSec: number;
        failureRate: number;
        dedupHitRate: number;
    };
    companies: PlatformQueueCompanyRow[];
};

export type PlatformOutboundHealth = {
    periodMinutes: number;
    summary: {
        pendingNow: number;
        processingNow: number;
        backlogTotal: number;
        doneWindow: number;
        failedWindow: number;
        skippedWindow: number;
        processedWindow: number;
        failureRate: number;
    };
    companies: Array<{
        companyId: string;
        companyName: string;
        pendingNow: number;
        processingNow: number;
        backlogTotal: number;
        doneWindow: number;
        failedWindow: number;
        skippedWindow: number;
        processedWindow: number;
        failureRate: number;
    }>;
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
    distinctRuns?: number;
    ingestEnabled?: boolean;
    turnTraceEnabled?: boolean;
    rows: PlatformPipelineRow[];
};

export type PlatformTurnTraceRow = {
    id: string;
    createdAt: string;
    companyId: string;
    companyName: string;
    threadId: string;
    channel: string;
    inboundMessageId: string;
    telemetryReason: string | null;
    aiProfile: string | null;
    outboundCount: number;
};

export type PlatformChatbotOpsSnapshot = {
    periodMinutes: number;
    generatedAt: string;
    ingest: { proPipelineSupabase: boolean; turnTrace: boolean };
    queue: PlatformQueueHealth;
    outbound: PlatformOutboundHealth;
    pipeline: PlatformPipelineHealth;
    recentTraces: { enabled: boolean; rows: PlatformTurnTraceRow[] };
};

export type PlatformMetricsQuery = {
    minutes?: number;
    companyId?: string | "all";
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
    companies: (filterQuery = "") => {
        const q = new URLSearchParams(
            filterQuery || "date_preset=all&account=all&limit=200"
        );
        if (!q.has("date_preset")) q.set("date_preset", "all");
        if (!q.has("limit")) q.set("limit", "200");
        return platformFetch<{
            companies: Array<{
                id: string;
                name: string | null;
                slug?: string | null;
                email?: string | null;
                is_active?: boolean;
                created_at?: string;
                onboarding_completed_at?: string | null;
                orderCount?: number;
                lastOrderAt?: string | null;
                channelCount?: number;
                activeChannelCount?: number;
                cidade?: string | null;
                uf?: string | null;
                cnpj?: string | null;
                subscription?: {
                    plan_id?: string;
                    status?: string;
                    plans?: { id?: string; name?: string; key?: string } | null;
                } | null;
            }>;
            total: number;
            page: number;
            limit: number;
            summary: {
                total: number;
                active: number;
                suspended: number;
                onboardingPending: number;
                trial: number;
                blocked: number;
            };
        }>(`/api/platform/companies?${q}`);
    },
    companiesExportUrl: (filterQuery = "") =>
        `/api/platform/companies?${filterQuery}${
            filterQuery ? "&" : ""
        }export=csv&limit=200`,
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
    orders: (page = 0, limit = 50, filterQuery = "") => {
        const q = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (filterQuery) {
            const extra = new URLSearchParams(filterQuery);
            extra.forEach((v, k) => q.set(k, v));
        }
        return platformFetch<PlatformOrdersListResponse>(`/api/platform/orders?${q}`);
    },
    metrics: ((
        kind:
            | "dashboard"
            | "queue"
            | "pipeline"
            | "outbound"
            | "ops"
            | "turn-traces",
        minutesOrFilters?: number | string | PlatformMetricsQuery,
        filterQuery?: string
    ) => {
        const q = new URLSearchParams({ kind });
        if (kind === "dashboard") {
            const fq =
                typeof minutesOrFilters === "string"
                    ? minutesOrFilters
                    : (filterQuery ?? "");
            if (fq) {
                const extra = new URLSearchParams(fq);
                extra.forEach((v, k) => q.set(k, v));
            }
            return platformFetch<PlatformDashboardStats>(`/api/platform/metrics?${q}`);
        }

        const opts: PlatformMetricsQuery =
            typeof minutesOrFilters === "object" && minutesOrFilters !== null
                ? minutesOrFilters
                : { minutes: typeof minutesOrFilters === "number" ? minutesOrFilters : 15 };

        if (opts.minutes != null) q.set("minutes", String(opts.minutes));
        if (opts.companyId && opts.companyId !== "all") {
            q.set("company_id", opts.companyId);
        }

        if (kind === "queue") {
            return platformFetch<PlatformQueueHealth>(`/api/platform/metrics?${q}`);
        }
        if (kind === "pipeline") {
            return platformFetch<PlatformPipelineHealth>(`/api/platform/metrics?${q}`);
        }
        if (kind === "outbound") {
            return platformFetch<PlatformOutboundHealth>(`/api/platform/metrics?${q}`);
        }
        if (kind === "ops") {
            return platformFetch<PlatformChatbotOpsSnapshot>(`/api/platform/metrics?${q}`);
        }
        if (kind === "turn-traces") {
            q.set("limit", String((opts as { limit?: number }).limit ?? 25));
            return platformFetch<{ enabled: boolean; rows: PlatformTurnTraceRow[] }>(
                `/api/platform/metrics?${q}`
            );
        }
    }) as {
        (kind: "dashboard", filterQuery?: string): Promise<PlatformDashboardStats>;
        (kind: "queue", opts?: PlatformMetricsQuery | number): Promise<PlatformQueueHealth>;
        (kind: "pipeline", opts?: PlatformMetricsQuery | number): Promise<PlatformPipelineHealth>;
        (kind: "outbound", opts?: PlatformMetricsQuery | number): Promise<PlatformOutboundHealth>;
        (kind: "ops", opts?: PlatformMetricsQuery | number): Promise<PlatformChatbotOpsSnapshot>;
        (kind: "turn-traces", opts?: PlatformMetricsQuery | number): Promise<{
            enabled: boolean;
            rows: PlatformTurnTraceRow[];
        }>;
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
    billingSettings: () =>
        platformFetch<{
            settings: { default_trial_days: number; updated_at: string; updated_by: string | null };
        }>("/api/platform/billing/settings"),
    updateBillingSettings: (default_trial_days: number) =>
        platformFetch<{
            settings: { default_trial_days: number; updated_at: string; updated_by: string | null };
        }>("/api/platform/billing/settings", {
            method:  "PATCH",
            body:    JSON.stringify({ default_trial_days }),
        }),
    neverPaidTenants: (page = 0, limit = 50) =>
        platformFetch<{
            ok: boolean;
            billing: "never_paid";
            tenants: Array<{
                companyId: string;
                companyName: string;
                email: string | null;
                cnpj: string | null;
                whatsappPhone: string | null;
                isActive: boolean;
                companyCreatedAt: string | null;
                pagarmeSubscriptionId: string;
                plan: string;
                billingStatus: string;
                trialEndsAt: string | null;
                pendingInvoice: {
                    id: string;
                    amount: number;
                    dueAt: string;
                    hasPix: boolean;
                    pixQrCode: string | null;
                    paymentUrl: string | null;
                } | null;
            }>;
            total: number;
            page: number;
            limit: number;
        }>(`/api/platform/tenants?billing=never_paid&page=${page}&limit=${limit}`),
    grantCourtesyTrial: (companyId: string, days: number, reason = "") =>
        platformFetch<{ ok: boolean; trial_ends_at: string; days: number }>(
            `/api/platform/tenants/${encodeURIComponent(companyId)}/courtesy-trial`,
            { method: "POST", body: JSON.stringify({ days, reason }) }
        ),
    ensureTenantCheckout: (companyId: string) =>
        platformFetch<{
            ok: boolean;
            invoice_id: string | null;
            pix_qr_code: string | null;
            invoice_ready: boolean;
            has_pix: boolean;
        }>(`/api/platform/tenants/${encodeURIComponent(companyId)}/ensure-checkout`, {
            method: "POST",
            body: JSON.stringify({}),
        }),
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
    alerts: () =>
        platformFetch<{
            ok: boolean;
            generatedAt: string;
            alerts: Array<{
                id: string;
                severity: "critical" | "warning" | "info";
                title: string;
                detail: string;
                code: string;
            }>;
            thresholds: {
                queuePendingN: number;
                queueAgeSec: number;
                failureRate: number;
            };
        }>("/api/platform/alerts"),
    startImpersonation: (company_id: string, reason: string) =>
        platformFetch<{ ok: boolean; sessionId: string }>("/api/platform/impersonate", {
            method: "POST",
            body: JSON.stringify({ company_id, reason }),
        }),
    endImpersonation: () =>
        platformFetch<{ ok: boolean }>("/api/platform/impersonate", { method: "DELETE" }),
};
