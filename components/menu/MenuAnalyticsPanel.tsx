"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import type { MenuAnalyticsResponse } from "@/src/types/contracts.public-menu";

const PERIODS = [
    { days: 7, label: "7 dias" },
    { days: 30, label: "30 dias" },
    { days: 90, label: "90 dias" },
] as const;

function Kpi({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg bg-zinc-50 px-3 py-3 dark:bg-zinc-900/50">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                {value.toLocaleString("pt-BR")}
            </p>
        </div>
    );
}

function RankList({
    title,
    empty,
    rows,
}: {
    title: string;
    empty: string;
    rows: Array<{ key: string; label: string; meta: string; value: number }>;
}) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return (
        <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {title}
            </h4>
            {rows.length === 0 ? (
                <p className="text-xs text-zinc-400">{empty}</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((r) => (
                        <li key={r.key}>
                            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-sm">
                                <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                                    {r.label}
                                </span>
                                <span className="shrink-0 tabular-nums text-zinc-500">
                                    {r.value.toLocaleString("pt-BR")} {r.meta}
                                </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <div
                                    className="h-full rounded-full bg-violet-500"
                                    style={{ width: `${Math.round((r.value / max) * 100)}%` }}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function MenuAnalyticsPanel() {
    const [days, setDays] = useState<7 | 30 | 90>(30);
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState<MenuAnalyticsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/menu-analytics?days=${days}`, {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json.error ?? "Falha ao carregar analytics");
                setAnalytics(null);
                return;
            }
            setAnalytics(json.analytics as MenuAnalyticsResponse);
        } catch {
            setError("Falha ao carregar analytics");
            setAnalytics(null);
        } finally {
            setLoading(false);
        }
    }, [days]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="space-y-5 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        <BarChart3 className="h-4 w-4 text-violet-600" />
                        Analytics do cardápio
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                        Visitas, produtos mais interagidos e origem (UTM) — sem dados pessoais.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {PERIODS.map((p) => (
                        <button
                            key={p.days}
                            type="button"
                            onClick={() => setDays(p.days)}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                days === p.days
                                    ? "bg-violet-600 text-white"
                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => void load()}
                        disabled={loading}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                        aria-label="Atualizar"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            {loading && !analytics ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            {analytics ? (
                <>
                    <div className="grid grid-cols-3 gap-2">
                        <Kpi label="Visitas" value={analytics.pageViews} />
                        <Kpi label="Visitantes" value={analytics.uniqueVisitors} />
                        <Kpi label="Produtos" value={analytics.productViews} />
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2">
                        <RankList
                            title="Top produtos"
                            empty="Ainda sem interações. Contabiliza ao adicionar item no cardápio."
                            rows={analytics.topProducts.map((p) => ({
                                key: p.productId,
                                label: p.name,
                                meta: "views",
                                value: p.views,
                            }))}
                        />
                        <RankList
                            title="Origem (UTM)"
                            empty="Sem visitas no período."
                            rows={analytics.utmSources.map((u) => ({
                                key: u.utmSource,
                                label: u.utmSource,
                                meta: "visitas",
                                value: u.pageViews,
                            }))}
                        />
                    </div>

                    {analytics.days.length > 0 ? (
                        <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Por dia
                            </h4>
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                                <table className="w-full text-left text-xs">
                                    <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Data</th>
                                            <th className="px-3 py-2 font-medium">Visitas</th>
                                            <th className="px-3 py-2 font-medium">Visitantes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...analytics.days].reverse().map((d) => (
                                            <tr
                                                key={d.date}
                                                className="border-t border-zinc-100 dark:border-zinc-800"
                                            >
                                                <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                                                    {d.date}
                                                </td>
                                                <td className="px-3 py-1.5 tabular-nums">
                                                    {d.pageViews}
                                                </td>
                                                <td className="px-3 py-1.5 tabular-nums">
                                                    {d.uniqueVisitors}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
