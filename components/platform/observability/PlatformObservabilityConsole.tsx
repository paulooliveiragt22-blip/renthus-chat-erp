"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import { buildProMetricsAlert } from "@/lib/platform/proMetricsAlert";
import {
    formatAgeSec,
    formatLastUpdated,
    formatPct,
    formatPeriodLabel,
    queueAlertBoxMessage,
    queueAlertBoxStyle,
    semaphoreLabel,
    semaphoreStyle,
} from "@/lib/platform/observabilityFormat";
import { classifyQueueHealth } from "@/lib/platform/observabilityThresholds";

type CompanyOpt = { id: string; name: string };
type QueueSortBy = "severity" | "failed" | "pending";

type Props = {
    companies: CompanyOpt[];
    showAlerts?: boolean;
    showHealthStats?: boolean;
};

export default function PlatformObservabilityConsole({
    companies,
    showAlerts = true,
    showHealthStats = true,
}: Props) {
    const [periodMinutes, setPeriodMinutes] = useState(15);
    const [companyId, setCompanyId] = useState<string>("all");
    const [sortBy, setSortBy] = useState<QueueSortBy>("severity");
    const [autoRefresh, setAutoRefresh] = useState(true);

    const metricsOpts = useMemo(
        () => ({
            minutes: periodMinutes,
            companyId: companyId === "all" ? ("all" as const) : companyId,
        }),
        [periodMinutes, companyId]
    );

    const { data: health, isLoading: healthLoading, refetch: refetchHealth, isFetching: fetchingHealth, dataUpdatedAt: healthUpdatedAt } = useQuery({
        queryKey: ["platform", "health", "extended"],
        queryFn: () => platformApi.healthExtended(),
        staleTime: 15_000,
        refetchInterval: autoRefresh ? 30_000 : false,
        enabled: showHealthStats,
    });

    const { data: alertsData, refetch: refetchAlerts, isFetching: fetchingAlerts } = useQuery({
        queryKey: ["platform", "alerts"],
        queryFn: () => platformApi.alerts(),
        staleTime: 15_000,
        refetchInterval: autoRefresh ? 30_000 : false,
        enabled: showAlerts,
    });

    const { data: queueHealthRaw, isLoading: isQueueLoading, dataUpdatedAt: queueUpdatedAt } = useQuery({
        queryKey: ["platform", "queue-health", metricsOpts],
        queryFn: () => platformApi.metrics("queue", metricsOpts),
        staleTime: 30_000,
        refetchInterval: autoRefresh ? 30_000 : false,
    });

    const { data: outboundHealth, isLoading: isOutboundLoading } = useQuery({
        queryKey: ["platform", "outbound-health", metricsOpts],
        queryFn: () => platformApi.metrics("outbound", metricsOpts),
        staleTime: 30_000,
        refetchInterval: autoRefresh ? 30_000 : false,
    });

    const { data: proMetrics, isLoading: isProLoading, dataUpdatedAt: proUpdatedAt } = useQuery({
        queryKey: ["platform", "pro-pipeline-metrics", metricsOpts],
        queryFn: () => platformApi.metrics("pipeline", metricsOpts),
        staleTime: 30_000,
        refetchInterval: autoRefresh ? 30_000 : false,
    });

    const { data: turnTraces, isLoading: tracesLoading } = useQuery({
        queryKey: ["platform", "turn-traces", companyId],
        queryFn: () => platformApi.metrics("turn-traces", metricsOpts),
        staleTime: 30_000,
        refetchInterval: autoRefresh ? 60_000 : false,
    });

    const queueHealth = useMemo(() => {
        if (!queueHealthRaw) return queueHealthRaw;
        const rows = [...queueHealthRaw.companies].sort((a, b) => compareRows(a, b, sortBy));
        return { ...queueHealthRaw, companies: rows };
    }, [queueHealthRaw, sortBy]);

    const proAlert = useMemo(
        () => buildProMetricsAlert(proMetrics, isProLoading, periodMinutes),
        [proMetrics, isProLoading, periodMinutes]
    );

    const alerts = alertsData?.alerts ?? [];
    const firing = alerts.filter((a) => a.severity === "critical" || a.severity === "warning");
    const isFetching = fetchingHealth || fetchingAlerts;
    const lastUpdatedAt = Math.max(healthUpdatedAt, queueUpdatedAt, proUpdatedAt);

    function refreshAll() {
        void refetchHealth();
        void refetchAlerts();
    }

    const queueSummary = queueHealth?.summary;
    const queueLevel = queueSummary
        ? classifyQueueHealth({
              failureRate: queueSummary.failureRate,
              pendingNow: queueSummary.pendingNow,
              processingNow: queueSummary.processingNow,
              backlogTotal: queueSummary.backlogTotal,
              failedWindow: queueSummary.failedWindow ?? queueSummary.failed15m,
              oldestPendingAgeSec: queueSummary.oldestPendingAgeSec,
          })
        : "stable";

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <option value="all">Todas empresas</option>
                        {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={String(periodMinutes)}
                        onChange={(e) => setPeriodMinutes(Number(e.target.value))}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <option value="15">15m</option>
                        <option value="60">1h</option>
                        <option value="1440">24h</option>
                    </select>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as QueueSortBy)}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <option value="severity">Ordenar: severidade</option>
                        <option value="failed">Ordenar: falhas</option>
                        <option value="pending">Ordenar: backlog</option>
                    </select>
                    <button
                        type="button"
                        onClick={() => setAutoRefresh((v) => !v)}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        {autoRefresh ? "Pausar auto-refresh" : "Retomar auto-refresh"}
                    </button>
                    <button
                        type="button"
                        onClick={refreshAll}
                        disabled={isFetching}
                        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <RefreshCcw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
                        Atualizar
                    </button>
                </div>
                <p className="text-[11px] text-zinc-400">
                    Última atualização: {formatLastUpdated(lastUpdatedAt)}{" "}
                    {autoRefresh ? "(auto 30s)" : "(auto pausado)"}
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <IngestBadge
                    label="Ingest PRO Supabase"
                    ok={proMetrics?.ingestEnabled === true}
                    hint="PRO_PIPELINE_METRICS_STORE=supabase"
                />
                <IngestBadge
                    label="Turn traces"
                    ok={turnTraces?.enabled === true}
                    hint="PRO_PIPELINE_TURN_TRACE=1"
                />
                <MiniStat
                    label="Runs PRO"
                    value={String(proMetrics?.distinctRuns ?? "—")}
                    loading={isProLoading}
                />
                <MiniStat
                    label="Backlog inbound"
                    value={String(queueSummary?.backlogTotal ?? queueSummary?.pendingNow ?? "—")}
                    loading={isQueueLoading}
                />
            </div>

            {showAlerts && alertsData && (
                <section className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        <ShieldAlert className="h-4 w-4" />
                        Alertas operacionais
                        <span className="text-[11px] font-normal text-zinc-400">
                            {alertsData.ok ? "tudo ok" : `${firing.length} ativo(s)`}
                        </span>
                    </div>
                    {firing.length === 0 ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                            Nenhuma regra crítica/warning disparada (backlog pending+processing, failure rate, suspensas).
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {firing.map((a) => (
                                <li
                                    key={a.id}
                                    className={[
                                        "rounded-xl border px-4 py-3 text-xs",
                                        a.severity === "critical"
                                            ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40"
                                            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30",
                                    ].join(" ")}
                                >
                                    <div className="font-semibold">
                                        [{a.severity}] {a.title}
                                    </div>
                                    <p className="mt-1 opacity-90">{a.detail}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {showHealthStats && health && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat
                        label="Postgres"
                        value={health.db === "up" ? "UP" : "DOWN"}
                        warn={health.db !== "up"}
                    />
                    <MiniStat label="Latência DB" value={`${health.latencyMs ?? "—"} ms`} />
                    <MiniStat
                        label="Env checks"
                        value={`${health.security?.checksOk ?? 0}/${health.security?.checksTotal ?? 0}`}
                        warn={(health.security?.failing?.length ?? 0) > 0}
                    />
                    <MiniStat
                        label="Outbound pending"
                        value={String(outboundHealth?.summary.pendingNow ?? "—")}
                        loading={isOutboundLoading}
                    />
                </div>
            )}

            {/* Fila inbound */}
            <Panel title="Saúde da Fila Chatbot (inbound)" subtitle="chatbot_queue → worker → runProPipeline">
                {queueSummary && (
                    <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${queueAlertBoxStyle(queueLevel)}`}>
                        {queueAlertBoxMessage(
                            {
                                failureRate: queueSummary.failureRate,
                                pendingNow: queueSummary.pendingNow,
                                processingNow: queueSummary.processingNow,
                                backlogTotal: queueSummary.backlogTotal,
                                failedWindow: queueSummary.failedWindow ?? queueSummary.failed15m,
                                oldestPendingAgeSec: queueSummary.oldestPendingAgeSec,
                            },
                            formatPeriodLabel(periodMinutes)
                        )}
                    </div>
                )}
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <MiniStat label="Failure rate" value={formatPct(queueSummary?.failureRate ?? 0)} loading={isQueueLoading} />
                    <MiniStat label="Dedup hit" value={formatPct(queueSummary?.dedupHitRate ?? 0)} loading={isQueueLoading} />
                    <MiniStat label="Processed" value={String(queueSummary?.processedWindow ?? queueSummary?.processed15m ?? 0)} loading={isQueueLoading} />
                    <MiniStat label="Pending" value={String(queueSummary?.pendingNow ?? 0)} loading={isQueueLoading} />
                    <MiniStat label="Processing" value={String(queueSummary?.processingNow ?? 0)} loading={isQueueLoading} />
                    <MiniStat
                        label="Idade pending"
                        value={queueSummary?.oldestPendingAgeSec != null ? formatAgeSec(queueSummary.oldestPendingAgeSec) : "—"}
                        loading={isQueueLoading}
                    />
                </div>
                <CompanyTable
                    loading={isQueueLoading}
                    emptyColSpan={7}
                    headers={["Empresa", "Semáforo", "Backlog", "Proc.", "Failed", "Fail%", "Dedup"]}
                    rows={(queueHealth?.companies ?? []).slice(0, 30).map((c) => ({
                        key: c.companyId,
                        cells: [
                            <Link key="n" href={`/platform/empresas/${c.companyId}`} className="text-violet-600 hover:underline">{c.companyName}</Link>,
                            <span key="s" className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${semaphoreStyle(c.severity)}`}>{semaphoreLabel(c.severity)}</span>,
                            String(c.backlogTotal ?? c.pendingNow),
                            String(c.processedWindow ?? c.processed15m),
                            String(c.failedWindow ?? c.failed15m),
                            formatPct(c.failureRate),
                            formatPct(c.dedupHitRate),
                        ],
                    }))}
                />
            </Panel>

            {/* Outbound */}
            <Panel title="Fila outbound (proativa)" subtitle="outbound_jobs — recovery, preparing notify">
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <MiniStat label="Backlog" value={String(outboundHealth?.summary.backlogTotal ?? 0)} loading={isOutboundLoading} />
                    <MiniStat label="Done" value={String(outboundHealth?.summary.doneWindow ?? 0)} loading={isOutboundLoading} />
                    <MiniStat label="Failed" value={String(outboundHealth?.summary.failedWindow ?? 0)} loading={isOutboundLoading} />
                    <MiniStat label="Skipped" value={String(outboundHealth?.summary.skippedWindow ?? 0)} loading={isOutboundLoading} />
                    <MiniStat label="Fail rate" value={formatPct(outboundHealth?.summary.failureRate ?? 0)} loading={isOutboundLoading} />
                </div>
                <CompanyTable
                    loading={isOutboundLoading}
                    emptyColSpan={6}
                    headers={["Empresa", "Backlog", "Done", "Failed", "Skipped", "Fail%"]}
                    rows={(outboundHealth?.companies ?? []).slice(0, 20).map((c) => ({
                        key: c.companyId,
                        cells: [
                            c.companyName,
                            String(c.backlogTotal),
                            String(c.doneWindow),
                            String(c.failedWindow),
                            String(c.skippedWindow),
                            formatPct(c.failureRate),
                        ],
                    }))}
                />
            </Panel>

            {/* PRO pipeline */}
            <Panel
                title="Métricas PRO pipeline"
                subtitle="pro_pipeline_metric_events — motor src/pro/pipeline/runProPipeline.ts"
            >
                <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${proAlert.style}`}>
                    {proAlert.message}
                </div>
                <div className="mb-4 flex flex-wrap gap-3">
                    <MiniStat label={`Volume (${formatPeriodLabel(periodMinutes)})`} value={String(proMetrics?.volume ?? 0)} loading={isProLoading} />
                    <MiniStat label="Distinct runs" value={String(proMetrics?.distinctRuns ?? 0)} loading={isProLoading} />
                </div>
                <CompanyTable
                    loading={isProLoading}
                    emptyColSpan={7}
                    headers={["Empresa", "Métrica", "reason", "intent", "errorCode", "provider", "Total"]}
                    rows={(proMetrics?.rows ?? []).slice(0, 40).map((r, i) => ({
                        key: `${r.companyId}-${r.metricName}-${i}`,
                        cells: [
                            r.companyName,
                            <code key="m" className="font-mono text-[10px]">{r.metricName}</code>,
                            r.reason ?? "—",
                            r.intent ?? "—",
                            r.errorCode ?? "—",
                            r.provider ?? "—",
                            r.total.toLocaleString("pt-BR"),
                        ],
                    }))}
                    emptyMessage="Sem eventos na janela ou ingest desligado."
                />
            </Panel>

            {/* Turn traces */}
            <Panel title="Turn traces (diagnóstico)" subtitle="pipeline_turn_traces — sem state/draft (sanitizado)">
                {!turnTraces?.enabled && (
                    <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                        Flag PRO_PIPELINE_TURN_TRACE desligada — traces não são gravados.
                    </p>
                )}
                <CompanyTable
                    loading={tracesLoading}
                    emptyColSpan={6}
                    headers={["Quando", "Empresa", "Canal", "Thread", "Motivo", "Out"]}
                    rows={(turnTraces?.rows ?? []).map((r) => ({
                        key: r.id,
                        cells: [
                            new Date(r.createdAt).toLocaleString("pt-BR"),
                            r.companyName,
                            r.channel,
                            r.threadId,
                            r.telemetryReason ?? "—",
                            String(r.outboundCount),
                        ],
                    }))}
                    emptyMessage="Nenhum trace recente."
                />
            </Panel>
        </div>
    );
}

function Panel({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
                <p className="text-xs text-zinc-400">{subtitle}</p>
            </div>
            {children}
        </div>
    );
}

function MiniStat({
    label,
    value,
    loading,
    warn,
}: {
    label: string;
    value: string;
    loading?: boolean;
    warn?: boolean;
}) {
    return (
        <div
            className={[
                "rounded-lg border p-3",
                warn
                    ? "border-amber-200 bg-amber-50 dark:border-amber-900/40"
                    : "border-zinc-200 dark:border-zinc-800",
            ].join(" ")}
        >
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {loading ? "—" : value}
            </div>
        </div>
    );
}

function IngestBadge({
    label,
    ok,
    hint,
}: {
    label: string;
    ok: boolean;
    hint: string;
}) {
    return (
        <div
            className={[
                "rounded-lg border px-3 py-2 text-xs",
                ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30",
            ].join(" ")}
        >
            <div className="font-semibold">{label}: {ok ? "ATIVO" : "OFF"}</div>
            <div className="mt-0.5 font-mono text-[10px] opacity-70">{hint}</div>
        </div>
    );
}

function CompanyTable({
    headers,
    rows,
    loading,
    emptyColSpan,
    emptyMessage = "Sem dados.",
}: {
    headers: string[];
    rows: Array<{ key: string; cells: ReactNode[] }>;
    loading?: boolean;
    emptyColSpan: number;
    emptyMessage?: string;
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        {headers.map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {loading && (
                        <tr>
                            <td colSpan={emptyColSpan} className="px-3 py-8 text-center">
                                <Loader2 className="mx-auto h-5 w-5 animate-spin text-zinc-400" />
                            </td>
                        </tr>
                    )}
                    {!loading && rows.length === 0 && (
                        <tr>
                            <td colSpan={emptyColSpan} className="px-3 py-6 text-center text-xs text-zinc-400">
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                    {!loading &&
                        rows.map((row) => (
                            <tr key={row.key}>
                                {row.cells.map((cell, i) => (
                                    <td key={`${row.key}-${i}`} className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                </tbody>
            </table>
        </div>
    );
}

function severityWeight(severity: string): number {
    if (severity === "red") return 2;
    if (severity === "yellow") return 1;
    return 0;
}

function compareRows(
    a: { severity: string; failed15m: number; failedWindow?: number; pendingNow: number; backlogTotal?: number },
    b: typeof a,
    sortBy: QueueSortBy
): number {
    const af = a.failedWindow ?? a.failed15m;
    const bf = b.failedWindow ?? b.failed15m;
    const ab = a.backlogTotal ?? a.pendingNow;
    const bb = b.backlogTotal ?? b.pendingNow;
    if (sortBy === "failed") return bf - af || bb - ab;
    if (sortBy === "pending") return bb - ab || bf - af;
    return severityWeight(b.severity) - severityWeight(a.severity) || bb - ab || bf - af;
}
