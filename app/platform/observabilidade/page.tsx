"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";

export default function PlatformObservabilidadePage() {
    const {
        data: health,
        isLoading,
        refetch: refetchHealth,
        isFetching: fetchingHealth,
    } = useQuery({
        queryKey: ["platform", "health", "extended"],
        queryFn: () => platformApi.healthExtended(),
        staleTime: 15_000,
        refetchInterval: 30_000,
    });

    const {
        data: alertsData,
        refetch: refetchAlerts,
        isFetching: fetchingAlerts,
    } = useQuery({
        queryKey: ["platform", "alerts"],
        queryFn: () => platformApi.alerts(),
        staleTime: 15_000,
        refetchInterval: 30_000,
    });

    const { data: queue } = useQuery({
        queryKey: ["platform", "metrics", "queue"],
        queryFn: () => platformApi.metrics("queue", 15),
        staleTime: 15_000,
    });

    const { data: pipeline } = useQuery({
        queryKey: ["platform", "metrics", "pipeline"],
        queryFn: () => platformApi.metrics("pipeline", 15),
        staleTime: 15_000,
    });

    const q = health;
    const queueSummary = queue?.summary;
    const pipelineVolume = pipeline?.volume;
    const alerts = alertsData?.alerts ?? [];
    const firing = alerts.filter((a) => a.severity === "critical" || a.severity === "warning");
    const isFetching = fetchingHealth || fetchingAlerts;

    function refreshAll() {
        void refetchHealth();
        void refetchAlerts();
    }

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                        Observabilidade
                    </h1>
                    <p className="text-xs text-zinc-500">
                        Saúde DB, alertas P2.4, fila chatbot, pipeline PRO e checklist de env
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refreshAll}
                    disabled={isFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            {isLoading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                </div>
            )}

            {alertsData && (
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
                            Nenhuma regra crítica/warning disparada agora (pending &gt;{" "}
                            {alertsData.thresholds.queuePendingN} por ≥
                            {Math.round(alertsData.thresholds.queueAgeSec / 60)} min; canais em
                            empresa suspensa; fila recente em suspensa).
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {firing.map((a) => (
                                <li
                                    key={a.id}
                                    className={[
                                        "rounded-xl border px-4 py-3 text-xs",
                                        a.severity === "critical"
                                            ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                                            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100",
                                    ].join(" ")}
                                >
                                    <div className="font-semibold">
                                        [{a.severity}] {a.title}
                                    </div>
                                    <p className="mt-1 opacity-90">{a.detail}</p>
                                    <code className="mt-1 block font-mono text-[10px] opacity-60">
                                        {a.code}
                                    </code>
                                </li>
                            ))}
                        </ul>
                    )}
                    {alerts
                        .filter((a) => a.severity === "info")
                        .map((a) => (
                            <p key={a.id} className="text-[11px] text-zinc-500">
                                {a.title}: {a.detail}
                            </p>
                        ))}
                </section>
            )}

            {q && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                        label="Postgres"
                        value={q.db === "up" ? "UP" : "DOWN"}
                        warn={q.db !== "up"}
                    />
                    <Stat label="Latência DB" value={`${q.latencyMs ?? "—"} ms`} />
                    <Stat
                        label="Fila pending"
                        value={String(q.queue?.pendingNow ?? queueSummary?.pendingNow ?? "—")}
                        warn={(q.queue?.pendingNow ?? 0) > 50}
                    />
                    <Stat
                        label="Falhas 15m"
                        value={String(q.queue?.failed15m ?? queueSummary?.failed15m ?? "—")}
                        warn={(q.queue?.failed15m ?? 0) > 0}
                    />
                    <Stat label="PRO volume 15m" value={String(pipelineVolume ?? "—")} />
                    <Stat
                        label="Env checks"
                        value={`${q.security?.checksOk ?? 0}/${q.security?.checksTotal ?? 0}`}
                        warn={(q.security?.failing?.length ?? 0) > 0}
                    />
                </div>
            )}

            {(q?.security?.failing?.length ?? 0) > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                        Variáveis faltando:{" "}
                        <code className="font-mono">{q!.security!.failing.join(", ")}</code>
                    </div>
                </div>
            )}
        </div>
    );
}

function Stat({
    label,
    value,
    warn,
}: {
    label: string;
    value: string;
    warn?: boolean;
}) {
    return (
        <div
            className={[
                "rounded-xl border p-4",
                warn
                    ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
            ].join(" ")}
        >
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
            <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {value}
            </div>
        </div>
    );
}
