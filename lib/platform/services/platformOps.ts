import type { SupabaseClient } from "@supabase/supabase-js";
import {
    sanitizeWhatsappChannelForClient,
} from "@/lib/whatsapp/channelCredentials";
import { invalidateWaConfig } from "@/lib/whatsapp/waConfigCache";
import { upsertWhatsappChannelCredentials } from "@/lib/channels/upsertWhatsappChannelCredentials";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";
import {
    dateFromToIsoStart,
    dateToToIsoEnd,
    defaultOrdersFilter,
    REVENUE_STATUSES_WHEN_ALL,
    type PlatformOrdersFilter,
} from "@/lib/platform/ordersFilters";
import {
    companyCreatedAtBounds,
    defaultCompaniesFilter,
    type PlatformCompaniesFilter,
} from "@/lib/platform/companiesFilters";

export type { PlatformOrdersFilter, PlatformCompaniesFilter };
export type PlatformOpsAuditCtx = {
    actor: PlatformActor;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

function envNonEmpty(name: string): boolean {
    const v = process.env[name];
    return typeof v === "string" && v.trim().length > 0;
}

export function getSecurityOpsStatus() {
    const vercelEnv = process.env.VERCEL_ENV ?? null;
    const nodeEnv = process.env.NODE_ENV ?? "development";
    const isProd =
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

    const checks = [
        {
            key: "WHATSAPP_APP_SECRET",
            label: "WHATSAPP_APP_SECRET",
            ok: envNonEmpty("WHATSAPP_APP_SECRET"),
            hint: "Assinatura HMAC dos webhooks Meta.",
        },
        {
            key: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            label: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            ok: envNonEmpty("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
            hint: "Verificação GET webhook Meta.",
        },
        {
            key: "CRON_SECRET",
            label: "CRON_SECRET",
            ok: !isProd || envNonEmpty("CRON_SECRET"),
            hint: "Crons exigem Bearer em produção.",
        },
        {
            key: "PLATFORM_ADMIN_IP_ALLOWLIST",
            label: "PLATFORM_ADMIN_IP_ALLOWLIST",
            ok: !isProd || envNonEmpty("PLATFORM_ADMIN_IP_ALLOWLIST"),
            hint: "Allowlist IP para /platform em produção.",
        },
        {
            key: "SUPABASE_SERVICE_ROLE_KEY",
            label: "SUPABASE_SERVICE_ROLE_KEY",
            ok: envNonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
            hint: "Chave service role.",
        },
        {
            key: "NEXT_PUBLIC_SUPABASE_URL",
            label: "NEXT_PUBLIC_SUPABASE_URL",
            ok: envNonEmpty("NEXT_PUBLIC_SUPABASE_URL"),
            hint: "URL Supabase.",
        },
        {
            key: "CREDENTIALS_ENCRYPTION_KEY",
            label: "CREDENTIALS_ENCRYPTION_KEY",
            ok: !isProd || envNonEmpty("CREDENTIALS_ENCRYPTION_KEY"),
            hint: "AES-256 tokens WA.",
        },
    ] as const;

    return { vercelEnv, nodeEnv, isProd, checks: [...checks] };
}

export async function getDashboardStats(
    admin: SupabaseClient,
    filters: PlatformOrdersFilter = defaultOrdersFilter()
) {
    const [companiesRes, channelsRes, orderStats] = await Promise.all([
        admin.from("companies").select("id", { count: "exact", head: true }),
        admin
            .from("whatsapp_channels")
            .select("id", { count: "exact", head: true })
            .eq("status", "active"),
        getOrdersAggregate(admin, filters),
    ]);

    return {
        totalCompanies: companiesRes.count ?? 0,
        activeChannels: channelsRes.count ?? 0,
        ordersThisMonth: orderStats.ordersCount,
        revenueThisMonth: orderStats.revenue,
        ordersCount: orderStats.ordersCount,
        revenue: orderStats.revenue,
        filtersApplied: filters,
        revenueNote:
            filters.status === "all"
                ? "Receita exclui cancelados quando status=Todos"
                : null,
    };
}

function applyOrdersFiltersToQuery<
    T extends {
        eq: (col: string, val: string) => T;
        gte: (col: string, val: string) => T;
        lte: (col: string, val: string) => T;
        in: (col: string, val: string[]) => T;
    },
>(q: T, filters: PlatformOrdersFilter, opts?: { forRevenue?: boolean }): T {
    let query = q;
    if (filters.companyId !== "all") {
        query = query.eq("company_id", filters.companyId);
    }
    if (filters.dateFrom !== "all") {
        query = query.gte("created_at", dateFromToIsoStart(filters.dateFrom));
    }
    if (filters.dateTo !== "all") {
        query = query.lte("created_at", dateToToIsoEnd(filters.dateTo));
    }
    if (opts?.forRevenue && filters.status === "all") {
        query = query.in("status", [...REVENUE_STATUSES_WHEN_ALL]);
    } else if (filters.status !== "all") {
        query = query.eq("status", filters.status);
    }
    return query;
}

export async function getOrdersAggregate(
    admin: SupabaseClient,
    filters: PlatformOrdersFilter
): Promise<{ ordersCount: number; revenue: number }> {
    let countQ = admin.from("orders").select("id", { count: "exact", head: true });
    countQ = applyOrdersFiltersToQuery(countQ as never, filters) as typeof countQ;

    let revenueQ = admin.from("orders").select("total_amount");
    revenueQ = applyOrdersFiltersToQuery(revenueQ as never, filters, {
        forRevenue: true,
    }) as typeof revenueQ;

    const [countRes, revenueRes] = await Promise.all([countQ, revenueQ]);
    if (countRes.error) throw new Error(countRes.error.message);
    if (revenueRes.error) throw new Error(revenueRes.error.message);

    const revenue = (revenueRes.data ?? []).reduce(
        (s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0),
        0
    );

    return { ordersCount: countRes.count ?? 0, revenue };
}

export async function getAllOrders(
    admin: SupabaseClient,
    page = 0,
    limit = 50,
    filters: PlatformOrdersFilter = defaultOrdersFilter()
) {
    let q = admin.from("orders").select(
        `
            id, total_amount, status, payment_method,
            created_at, source, company_id,
            companies ( id, name )
        `,
        { count: "exact" }
    );
    q = applyOrdersFiltersToQuery(q as never, filters) as typeof q;

    const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

    if (error) throw new Error(error.message);

    const aggregate = await getOrdersAggregate(admin, filters);

    return {
        orders: data ?? [],
        total: count ?? 0,
        ordersCount: aggregate.ordersCount,
        revenue: aggregate.revenue,
        filtersApplied: filters,
    };
}

import {
    computeDedupHitRate,
    isPipelineTurnTraceEnabled,
    isProPipelineIngestEnabled,
    queueCompanySeverity,
} from "@/lib/platform/observabilityThresholds";

type QueueHealthBaseRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    processingNow: number;
    oldestPendingAgeSec: number;
    doneWindow: number;
    failedWindow: number;
    coalescedWindow: number;
};

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return numerator / denominator;
}

function ensureCompanyRow(map: Map<string, QueueHealthBaseRow>, companyId: string): QueueHealthBaseRow {
    if (!map.has(companyId)) {
        map.set(companyId, {
            companyId,
            companyName: companyId,
            pendingNow: 0,
            processingNow: 0,
            oldestPendingAgeSec: 0,
            doneWindow: 0,
            failedWindow: 0,
            coalescedWindow: 0,
        });
    }
    return map.get(companyId)!;
}

function mapQueueRow(item: QueueHealthBaseRow) {
    const processedWindow = item.doneWindow + item.failedWindow;
    const failureRate = ratio(item.failedWindow, processedWindow);
    const dedupHitRate = computeDedupHitRate(item.coalescedWindow, item.doneWindow);
    const severity = queueCompanySeverity(
        failureRate,
        item.pendingNow,
        item.processingNow
    );
    return {
        ...item,
        /** @deprecated use failedWindow */
        failed15m: item.failedWindow,
        /** @deprecated use doneWindow */
        done15m: item.doneWindow,
        /** @deprecated use coalescedWindow */
        coalesced15m: item.coalescedWindow,
        processed15m: processedWindow,
        processedWindow,
        backlogTotal: item.pendingNow + item.processingNow,
        failureRate,
        dedupHitRate,
        severity,
    };
}

export async function getQueueHealthStats(
    admin: SupabaseClient,
    periodMinutes = 15,
    companyId?: string | "all"
) {
    const windowStart = new Date(Date.now() - periodMinutes * 60_000).toISOString();

    let pendingQ = admin
        .from("chatbot_queue")
        .select("company_id, scheduled_at")
        .eq("status", "pending");
    let processingQ = admin
        .from("chatbot_queue")
        .select("company_id")
        .eq("status", "processing");
    let recentQ = admin
        .from("chatbot_queue")
        .select("company_id, status, last_error")
        .gte("created_at", windowStart)
        .in("status", ["done", "failed"]);
    let oldestPendingBuilder = admin
        .from("chatbot_queue")
        .select("scheduled_at")
        .eq("status", "pending");

    if (companyId && companyId !== "all") {
        pendingQ = pendingQ.eq("company_id", companyId);
        processingQ = processingQ.eq("company_id", companyId);
        recentQ = recentQ.eq("company_id", companyId);
        oldestPendingBuilder = oldestPendingBuilder.eq("company_id", companyId);
    }

    const [pendingRes, processingRes, recentRes, oldestPendingRes] = await Promise.all([
        pendingQ,
        processingQ,
        recentQ,
        oldestPendingBuilder
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);

    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (processingRes.error) throw new Error(processingRes.error.message);
    if (recentRes.error) throw new Error(recentRes.error.message);

    const byCompany = new Map<string, QueueHealthBaseRow>();
    const nowMs = Date.now();
    let globalOldestAgeSec = 0;

    for (const row of pendingRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensureCompanyRow(byCompany, row.company_id);
        item.pendingNow += 1;
        if (typeof row.scheduled_at === "string") {
            const age = Math.max(
                0,
                Math.floor((nowMs - new Date(row.scheduled_at).getTime()) / 1000)
            );
            if (age > item.oldestPendingAgeSec) item.oldestPendingAgeSec = age;
            if (age > globalOldestAgeSec) globalOldestAgeSec = age;
        }
    }

    for (const row of processingRes.data ?? []) {
        if (!row.company_id) continue;
        ensureCompanyRow(byCompany, row.company_id).processingNow += 1;
    }

    if (typeof oldestPendingRes.data?.scheduled_at === "string") {
        const age = Math.max(
            0,
            Math.floor(
                (nowMs - new Date(oldestPendingRes.data.scheduled_at).getTime()) / 1000
            )
        );
        if (age > globalOldestAgeSec) globalOldestAgeSec = age;
    }

    for (const row of recentRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensureCompanyRow(byCompany, row.company_id);
        if (row.status === "failed") item.failedWindow += 1;
        if (row.status === "done") item.doneWindow += 1;
        if (row.last_error === "coalesced_duplicate_inbound") item.coalescedWindow += 1;
    }

    const companyIds = [...byCompany.keys()];
    if (companyIds.length) {
        const { data: companies, error: companiesErr } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        if (companiesErr) throw new Error(companiesErr.message);
        for (const c of companies ?? []) {
            const item = byCompany.get(c.id);
            if (item) item.companyName = c.name ?? c.id;
        }
    }

    const items = [...byCompany.values()]
        .map(mapQueueRow)
        .filter((item) => item.backlogTotal > 0 || item.processedWindow > 0);

    const summaryRaw = items.reduce(
        (acc, item) => {
            acc.pendingNow += item.pendingNow;
            acc.processingNow += item.processingNow;
            acc.processedWindow += item.processedWindow;
            acc.failedWindow += item.failedWindow;
            acc.doneWindow += item.doneWindow;
            acc.coalescedWindow += item.coalescedWindow;
            if (item.oldestPendingAgeSec > acc.oldestPendingAgeSec) {
                acc.oldestPendingAgeSec = item.oldestPendingAgeSec;
            }
            return acc;
        },
        {
            pendingNow: 0,
            processingNow: 0,
            processedWindow: 0,
            failedWindow: 0,
            doneWindow: 0,
            coalescedWindow: 0,
            oldestPendingAgeSec: globalOldestAgeSec,
        }
    );

    const summary = {
        ...summaryRaw,
        backlogTotal: summaryRaw.pendingNow + summaryRaw.processingNow,
        /** @deprecated alias */
        processed15m: summaryRaw.processedWindow,
        /** @deprecated alias */
        failed15m: summaryRaw.failedWindow,
        /** @deprecated alias */
        coalesced15m: summaryRaw.coalescedWindow,
        failureRate: ratio(summaryRaw.failedWindow, summaryRaw.processedWindow),
        dedupHitRate: computeDedupHitRate(
            summaryRaw.coalescedWindow,
            summaryRaw.doneWindow
        ),
    };

    return {
        periodMinutes,
        summary,
        companies: items,
    };
}

type OutboundHealthBaseRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    processingNow: number;
    doneWindow: number;
    failedWindow: number;
    skippedWindow: number;
};

export async function getOutboundHealthStats(
    admin: SupabaseClient,
    periodMinutes = 15,
    companyId?: string | "all"
) {
    const windowStart = new Date(Date.now() - periodMinutes * 60_000).toISOString();

    let pendingQ = admin.from("outbound_jobs").select("company_id").eq("status", "pending");
    let processingQ = admin
        .from("outbound_jobs")
        .select("company_id")
        .eq("status", "processing");
    let recentQ = admin
        .from("outbound_jobs")
        .select("company_id, status")
        .gte("created_at", windowStart)
        .in("status", ["done", "failed", "skipped"]);

    if (companyId && companyId !== "all") {
        pendingQ = pendingQ.eq("company_id", companyId);
        processingQ = processingQ.eq("company_id", companyId);
        recentQ = recentQ.eq("company_id", companyId);
    }

    const [pendingRes, processingRes, recentRes] = await Promise.all([
        pendingQ,
        processingQ,
        recentQ,
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (processingRes.error) throw new Error(processingRes.error.message);
    if (recentRes.error) throw new Error(recentRes.error.message);

    const byCompany = new Map<string, OutboundHealthBaseRow>();

    function ensure(id: string): OutboundHealthBaseRow {
        if (!byCompany.has(id)) {
            byCompany.set(id, {
                companyId: id,
                companyName: id,
                pendingNow: 0,
                processingNow: 0,
                doneWindow: 0,
                failedWindow: 0,
                skippedWindow: 0,
            });
        }
        return byCompany.get(id)!;
    }

    for (const row of pendingRes.data ?? []) {
        if (row.company_id) ensure(row.company_id).pendingNow += 1;
    }
    for (const row of processingRes.data ?? []) {
        if (row.company_id) ensure(row.company_id).processingNow += 1;
    }
    for (const row of recentRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensure(row.company_id);
        if (row.status === "done") item.doneWindow += 1;
        if (row.status === "failed") item.failedWindow += 1;
        if (row.status === "skipped") item.skippedWindow += 1;
    }

    const companyIds = [...byCompany.keys()];
    if (companyIds.length) {
        const { data: companies } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        for (const c of companies ?? []) {
            const item = byCompany.get(c.id);
            if (item) item.companyName = c.name ?? c.id;
        }
    }

    const items = [...byCompany.values()]
        .map((item) => {
            const processedWindow =
                item.doneWindow + item.failedWindow + item.skippedWindow;
            const failureRate = ratio(item.failedWindow, item.doneWindow + item.failedWindow);
            return {
                ...item,
                processedWindow,
                backlogTotal: item.pendingNow + item.processingNow,
                failureRate,
            };
        })
        .filter((item) => item.backlogTotal > 0 || item.processedWindow > 0);

    const summaryRaw = items.reduce(
        (acc, item) => ({
            pendingNow: acc.pendingNow + item.pendingNow,
            processingNow: acc.processingNow + item.processingNow,
            doneWindow: acc.doneWindow + item.doneWindow,
            failedWindow: acc.failedWindow + item.failedWindow,
            skippedWindow: acc.skippedWindow + item.skippedWindow,
        }),
        {
            pendingNow: 0,
            processingNow: 0,
            doneWindow: 0,
            failedWindow: 0,
            skippedWindow: 0,
        }
    );

    const processedWindow =
        summaryRaw.doneWindow + summaryRaw.failedWindow + summaryRaw.skippedWindow;

    return {
        periodMinutes,
        summary: {
            ...summaryRaw,
            backlogTotal: summaryRaw.pendingNow + summaryRaw.processingNow,
            processedWindow,
            failureRate: ratio(
                summaryRaw.failedWindow,
                summaryRaw.doneWindow + summaryRaw.failedWindow
            ),
        },
        companies: items,
    };
}

export async function getProPipelineHealthStats(
    admin: SupabaseClient,
    periodMinutes = 15,
    companyId?: string | "all"
) {
    const { data: raw, error } = await admin.rpc("superadmin_pro_pipeline_metric_totals", {
        p_window_minutes: periodMinutes,
    });
    if (error) throw new Error(error.message);

    type RpcRow = {
        company_id: string;
        metric_name: string;
        reason_key: string;
        intent_key: string;
        error_code: string;
        provider_key: string;
        total: number | string;
    };

    let rows = (raw ?? []) as RpcRow[];
    if (companyId && companyId !== "all") {
        rows = rows.filter((r) => r.company_id === companyId);
    }

    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const nameById = new Map<string, string>();
    if (companyIds.length) {
        const { data: companies, error: companiesErr } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        if (companiesErr) throw new Error(companiesErr.message);
        for (const c of companies ?? []) {
            nameById.set(c.id, c.name ?? c.id);
        }
    }

    const aggregates = rows.map((r) => ({
        companyId: r.company_id,
        companyName: nameById.get(r.company_id) ?? r.company_id,
        metricName: r.metric_name,
        reason: r.reason_key.length ? r.reason_key : null,
        intent: r.intent_key.length ? r.intent_key : null,
        errorCode: r.error_code.length ? r.error_code : null,
        provider: r.provider_key.length ? r.provider_key : null,
        total: typeof r.total === "string" ? Number(r.total) : r.total,
    }));

    const runRows = aggregates.filter((r) => r.metricName === "pro_pipeline.run");
    const distinctRuns = runRows.reduce((s, r) => s + r.total, 0);

    return {
        periodMinutes,
        volume: aggregates.reduce((s, r) => s + r.total, 0),
        distinctRuns,
        ingestEnabled: isProPipelineIngestEnabled(),
        turnTraceEnabled: isPipelineTurnTraceEnabled(),
        rows: aggregates,
    };
}

/** Leitura sanitizada — sem state json completo (evita PII no painel). */
export async function getPipelineTurnTraces(
    admin: SupabaseClient,
    opts: { companyId?: string; limit?: number } = {}
) {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 25));
    let q = admin
        .from("pipeline_turn_traces")
        .select(
            "id, created_at, company_id, thread_id, channel, inbound_message_id, telemetry_reason, ai_profile, outbound"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

    if (opts.companyId && opts.companyId !== "all") {
        q = q.eq("company_id", opts.companyId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const companyIds = [...new Set((data ?? []).map((r) => r.company_id as string))];
    const nameById = new Map<string, string>();
    if (companyIds.length) {
        const { data: companies } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        for (const c of companies ?? []) {
            nameById.set(c.id, c.name ?? c.id);
        }
    }

    return {
        enabled: isPipelineTurnTraceEnabled(),
        rows: (data ?? []).map((r) => ({
            id: r.id as string,
            createdAt: r.created_at as string,
            companyId: r.company_id as string,
            companyName: nameById.get(r.company_id as string) ?? (r.company_id as string),
            threadId: (r.thread_id as string).slice(0, 8) + "…",
            channel: r.channel as string,
            inboundMessageId: String(r.inbound_message_id).slice(-8),
            telemetryReason: (r.telemetry_reason as string | null) ?? null,
            aiProfile: (r.ai_profile as string | null) ?? null,
            outboundCount: Array.isArray(r.outbound) ? r.outbound.length : 0,
        })),
    };
}

export async function getChatbotOpsSnapshot(
    admin: SupabaseClient,
    periodMinutes = 15,
    companyId?: string | "all"
) {
    const [queue, outbound, pipeline, traces] = await Promise.all([
        getQueueHealthStats(admin, periodMinutes, companyId),
        getOutboundHealthStats(admin, periodMinutes, companyId),
        getProPipelineHealthStats(admin, periodMinutes, companyId),
        getPipelineTurnTraces(admin, {
            companyId: companyId === "all" ? undefined : companyId,
            limit: 10,
        }),
    ]);

    return {
        periodMinutes,
        generatedAt: new Date().toISOString(),
        ingest: {
            proPipelineSupabase: pipeline.ingestEnabled,
            turnTrace: pipeline.turnTraceEnabled,
        },
        queue,
        outbound,
        pipeline,
        recentTraces: traces,
    };
}

export async function getPlans(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("plans")
        .select("id, key, name, price_cents")
        .order("price_cents");
    if (error) throw new Error(error.message);
    return data ?? [];
}

type CompanyListRow = {
    id: string;
    name: string | null;
    slug: string | null;
    email: string | null;
    phone: string | null;
    cnpj: string | null;
    cidade: string | null;
    uf: string | null;
    created_at: string;
    updated_at: string | null;
    onboarding_completed_at: string | null;
    is_active: boolean;
    subscriptions?: unknown;
};

export type PlatformCompanyListItem = {
    id: string;
    name: string | null;
    slug: string | null;
    email: string | null;
    phone: string | null;
    cnpj: string | null;
    cidade: string | null;
    uf: string | null;
    created_at: string;
    updated_at: string | null;
    onboarding_completed_at: string | null;
    is_active: boolean;
    orderCount: number;
    lastOrderAt: string | null;
    channelCount: number;
    activeChannelCount: number;
    subscription: {
        plan_id?: string;
        status?: string;
        plans?: { id?: string; name?: string; key?: string } | null;
    } | null;
};

export type PlatformCompaniesSummary = {
    total: number;
    active: number;
    suspended: number;
    onboardingPending: number;
    trial: number;
    blocked: number;
};

export async function getCompanies(
    admin: SupabaseClient,
    filters: PlatformCompaniesFilter = defaultCompaniesFilter(),
    opts: { page?: number; limit?: number; forExport?: boolean } = {}
) {
    const page = Math.max(0, opts.page ?? 0);
    const limitCap = opts.forExport ? 5000 : 200;
    const limit = Math.min(limitCap, Math.max(1, opts.limit ?? 50));

    let q = admin.from("companies").select(`
            id, name, slug, email, phone, cnpj, cidade, uf, created_at, updated_at,
            onboarding_completed_at, is_active,
            subscriptions ( plan_id, status, plans ( id, name, key ) )
        `);

    if (filters.account === "active") q = q.eq("is_active", true);
    if (filters.account === "suspended") q = q.eq("is_active", false);

    const bounds = companyCreatedAtBounds(filters);
    if (bounds.fromIso) q = q.gte("created_at", bounds.fromIso);
    if (bounds.toIso) q = q.lte("created_at", bounds.toIso);

    if (filters.onboarding === "done") {
        q = q.not("onboarding_completed_at", "is", null);
    } else if (filters.onboarding === "pending") {
        q = q.is("onboarding_completed_at", null);
    }

    if (filters.cidade) {
        q = q.ilike("cidade", `%${filters.cidade}%`);
    }
    if (filters.uf !== "all") {
        q = q.eq("uf", filters.uf);
    }

    if (filters.q) {
        const term = filters.q.replaceAll(/[%_,.()]/g, " ").trim();
        if (term) {
            const like = `%${term}%`;
            q = q.or(
                `name.ilike.${like},email.ilike.${like},slug.ilike.${like},cnpj.ilike.${like},phone.ilike.${like}`
            );
        }
    }

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    let rows = (data ?? []) as CompanyListRow[];

    if (filters.planId !== "all" || filters.subStatus !== "all") {
        rows = rows.filter((c) => {
            const sub = Array.isArray(c.subscriptions)
                ? c.subscriptions[0]
                : c.subscriptions;
            const s = sub as
                | { plan_id?: string; status?: string }
                | null
                | undefined;
            if (filters.planId !== "all" && s?.plan_id !== filters.planId) {
                return false;
            }
            if (filters.subStatus !== "all" && s?.status !== filters.subStatus) {
                return false;
            }
            return true;
        });
    }

    const ids = rows.map((c) => c.id);
    const orderCounts: Record<string, number> = {};
    const lastOrderAt: Record<string, string> = {};
    const channelCount: Record<string, number> = {};
    const activeChannelCount: Record<string, number> = {};

    if (ids.length) {
        const [ordersRes, channelsRes] = await Promise.all([
            admin.from("orders").select("company_id, created_at").in("company_id", ids),
            admin
                .from("whatsapp_channels")
                .select("company_id, status")
                .in("company_id", ids),
        ]);

        for (const o of ordersRes.data ?? []) {
            const cid = o.company_id as string;
            orderCounts[cid] = (orderCounts[cid] ?? 0) + 1;
            const at = o.created_at as string;
            if (!lastOrderAt[cid] || at > lastOrderAt[cid]!) {
                lastOrderAt[cid] = at;
            }
        }
        for (const ch of channelsRes.data ?? []) {
            const cid = ch.company_id as string;
            channelCount[cid] = (channelCount[cid] ?? 0) + 1;
            if (ch.status === "active") {
                activeChannelCount[cid] = (activeChannelCount[cid] ?? 0) + 1;
            }
        }
    }

    let enriched: PlatformCompanyListItem[] = rows.map((c) => {
        const subRaw = Array.isArray(c.subscriptions)
            ? c.subscriptions[0]
            : c.subscriptions;
        return {
            id: c.id,
            name: c.name,
            slug: c.slug,
            email: c.email,
            phone: c.phone,
            cnpj: c.cnpj,
            cidade: c.cidade,
            uf: c.uf,
            created_at: c.created_at,
            updated_at: c.updated_at,
            onboarding_completed_at: c.onboarding_completed_at,
            is_active: c.is_active,
            orderCount: orderCounts[c.id] ?? 0,
            lastOrderAt: lastOrderAt[c.id] ?? null,
            channelCount: channelCount[c.id] ?? 0,
            activeChannelCount: activeChannelCount[c.id] ?? 0,
            subscription: (subRaw as PlatformCompanyListItem["subscription"]) ?? null,
        };
    });

    if (filters.wa !== "all") {
        enriched = enriched.filter((c) => {
            if (filters.wa === "none") return c.channelCount === 0;
            if (filters.wa === "active") return c.activeChannelCount > 0;
            if (filters.wa === "inactive") {
                return c.channelCount > 0 && c.activeChannelCount === 0;
            }
            return true;
        });
    }

    const summary: PlatformCompaniesSummary = {
        total: enriched.length,
        active: enriched.filter((c) => c.is_active).length,
        suspended: enriched.filter((c) => !c.is_active).length,
        onboardingPending: enriched.filter((c) => !c.onboarding_completed_at)
            .length,
        trial: enriched.filter((c) => c.subscription?.status === "trial").length,
        blocked: enriched.filter((c) => c.subscription?.status === "blocked")
            .length,
    };

    const sort = filters.sort;
    enriched.sort((a, b) => {
        if (sort === "name") {
            return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
        }
        if (sort === "order_count") {
            return b.orderCount - a.orderCount;
        }
        if (sort === "last_order_at") {
            const av = a.lastOrderAt ?? "";
            const bv = b.lastOrderAt ?? "";
            return bv.localeCompare(av);
        }
        return b.created_at.localeCompare(a.created_at);
    });

    const total = enriched.length;
    const slice = enriched.slice(page * limit, (page + 1) * limit);

    return {
        companies: slice,
        total,
        page,
        limit,
        summary,
        filtersApplied: filters,
    };
}

export async function getCompany(admin: SupabaseClient, id: string) {
    const [compRes, channelsRes, ordersRes, usersRes] = await Promise.all([
        admin
            .from("companies")
            .select(`
                id, name, slug, email, phone, cnpj, razao_social, nome_fantasia,
                cidade, cep, endereco, numero, bairro, uf, whatsapp_phone,
                created_at, updated_at, onboarding_completed_at, is_active,
                subscriptions ( id, plan_id, status, allow_overage, started_at, plans ( id, name ) )
            `)
            .eq("id", id)
            .maybeSingle(),
        admin
            .from("whatsapp_channels")
            .select("id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at")
            .eq("company_id", id)
            .order("created_at", { ascending: false }),
        admin
            .from("orders")
            .select("id, total_amount, status, payment_method, created_at")
            .eq("company_id", id)
            .order("created_at", { ascending: false })
            .limit(20),
        admin
            .from("company_users")
            .select("user_id, role, created_at")
            .eq("company_id", id)
            .limit(10),
    ]);

    if (!compRes.data) return null;

    const company = compRes.data as Record<string, unknown> & { subscriptions?: unknown };
    const sub = Array.isArray(company.subscriptions) ? company.subscriptions[0] : null;
    const rawChannels = channelsRes.data ?? [];

    return {
        company: { ...company, subscriptions: undefined },
        sub,
        channels: rawChannels.map((row: Record<string, unknown>) =>
            sanitizeWhatsappChannelForClient(row as Parameters<typeof sanitizeWhatsappChannelForClient>[0])
        ),
        orders: ordersRes.data ?? [],
        users: usersRes.data ?? [],
    };
}

export async function createCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    data: {
        name: string;
        email?: string;
        slug?: string;
        cnpj?: string;
        razao_social?: string;
        phone?: string;
        cidade?: string;
        plan_id: string;
    }
) {
    const { name, plan_id, ...rest } = data;

    const { data: company, error: cErr } = await admin
        .from("companies")
        .insert({ name, ...rest })
        .select("id")
        .single();

    if (cErr) throw new Error(cErr.message);

    const { error: sErr } = await admin.from("subscriptions").insert({
        company_id: company.id,
        plan_id,
        status: "active",
        started_at: new Date().toISOString(),
    });

    if (sErr) throw new Error(sErr.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.created",
        resourceType: "company",
        resourceId: company.id,
        companyId: company.id,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { name, plan_id },
    });

    return company.id as string;
}

export async function updateCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    id: string,
    data: Record<string, unknown>
) {
    const { data: before } = await admin
        .from("companies")
        .select("name, email, slug, is_active")
        .eq("id", id)
        .maybeSingle();

    const { error } = await admin
        .from("companies")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.updated",
        resourceType: "company",
        resourceId: id,
        companyId: id,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: (before as Record<string, unknown>) ?? null,
        afterState: data,
    });
}

export async function suspendCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_suspend_company", {
        p_company_id: companyId,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function reactivateCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_reactivate_company", {
        p_company_id: companyId,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function getAllChannels(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("whatsapp_channels")
        .select(`
            id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at,
            companies ( id, name )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: Record<string, unknown>) => ({
        ...sanitizeWhatsappChannelForClient(row as Parameters<typeof sanitizeWhatsappChannelForClient>[0]),
        companies: row.companies,
    }));
}

export async function updateChannelIdentifier(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    fromIdentifier: string
) {
    const { data: row } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("id", channelId)
        .maybeSingle();
    const { error } = await admin
        .from("whatsapp_channels")
        .update({ from_identifier: fromIdentifier })
        .eq("id", channelId);
    if (error) throw new Error(error.message);
    if (row?.company_id) invalidateWaConfig(row.company_id as string);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.updated",
        resourceType: "channel",
        resourceId: channelId,
        companyId: row?.company_id as string | undefined,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { from_identifier: fromIdentifier },
    });
}

export async function createChannel(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    data: {
        phone_number_id: string;
        access_token: string;
        waba_id?: string;
        whatsapp_phone?: string;
    }
) {
    const result = await upsertWhatsappChannelCredentials(admin, {
        companyId,
        phoneNumberId: data.phone_number_id,
        accessToken: data.access_token,
        wabaId: data.waba_id,
        whatsappPhone: data.whatsapp_phone,
        actor: { kind: "platform", userId: audit.actor.id },
    });

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.created",
        resourceType: "channel",
        resourceId: result.channel.id,
        companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
    });
}

export async function updateChannelCredentials(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    data: {
        phone_number_id?: string;
        access_token?: string;
        waba_id?: string;
    }
) {
    const { data: ch, error: loadErr } = await admin
        .from("whatsapp_channels")
        .select("company_id, from_identifier")
        .eq("id", channelId)
        .single();

    if (loadErr || !ch) throw new Error(loadErr?.message ?? "Canal não encontrado");

    const companyId = ch.company_id as string;
    const phoneNumberId =
        data.phone_number_id?.trim() || String(ch.from_identifier ?? "").trim();
    if (!phoneNumberId) throw new Error("Phone Number ID é obrigatório.");

    const result = await upsertWhatsappChannelCredentials(admin, {
        companyId,
        channelId,
        phoneNumberId,
        accessToken: data.access_token,
        wabaId: data.waba_id,
        actor: { kind: "platform", userId: audit.actor.id },
    });

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.credentials_updated",
        resourceType: "channel",
        resourceId: result.channel.id,
        companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
    });
}

export async function updateChannelStatus(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    status: "active" | "inactive"
) {
    const { data: row } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("id", channelId)
        .maybeSingle();
    const { error } = await admin.from("whatsapp_channels").update({ status }).eq("id", channelId);
    if (error) throw new Error(error.message);
    if (row?.company_id) invalidateWaConfig(row.company_id as string);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.status_changed",
        resourceType: "channel",
        resourceId: channelId,
        companyId: row?.company_id as string | undefined,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { status },
    });
}

export async function listPlatformAudit(
    admin: SupabaseClient,
    opts: { limit: number; offset: number; companyId?: string; action?: string }
) {
    let q = admin
        .from("platform_audit_log")
        .select(
            "id, occurred_at, actor_email, actor_role, action, resource_type, resource_id, company_id, outcome",
            { count: "exact" }
        )
        .order("occurred_at", { ascending: false })
        .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.companyId) q = q.eq("company_id", opts.companyId);
    if (opts.action) q = q.eq("action", opts.action);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: data ?? [], total: count ?? 0 };
}

export async function listPlatformUsers(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("platform_users")
        .select("id, email, display_name, role, is_active, mfa_required, last_login_at, created_at")
        .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function updateSubscription(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    subId: string,
    data: { plan_id?: string; status?: string; allow_overage?: boolean }
) {
    const { data: before } = await admin
        .from("subscriptions")
        .select("plan_id, status, allow_overage, company_id")
        .eq("id", subId)
        .maybeSingle();

    const { error } = await admin.from("subscriptions").update(data).eq("id", subId);
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.updated",
        resourceType: "subscription",
        resourceId: subId,
        companyId: (before as { company_id?: string } | null)?.company_id ?? null,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: (before as Record<string, unknown>) ?? null,
        afterState: data,
    });
}
