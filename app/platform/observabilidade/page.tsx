"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";

export default function PlatformObservabilidadePage() {
    const { data: health, isLoading, refetch, isFetching } = useQuery({
        queryKey: ["platform", "health", "extended"],
        queryFn: () => platformApi.healthExtended(),
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

    const q = health as {
        ok?: boolean;
        db?: string;
        latencyMs?: number;
        queue?: { pendingNow: number; failed15m: number; failureRate: number };
        security?: { checksOk: number; checksTotal: number; failing: string[] };
    } | undefined;

    const queueSummary = (queue as { summary?: { pendingNow: number; failed15m: number } } | undefined)
        ?.summary;
    const pipelineVolume = (pipeline as { volume?: number } | undefined)?.volume;

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                        Observabilidade
                    </h1>
                    <p className="text-xs text-zinc-500">
                        Saúde DB, fila chatbot, pipeline PRO e checklist de env
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => refetch()}
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
            <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
        </div>
    );
}
