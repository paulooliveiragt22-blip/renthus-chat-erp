"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Loader2, MessageSquare, Receipt, TrendingUp } from "lucide-react";
import { getDashboardStats, getQueueHealthStats } from "@/lib/superadmin/actions";

type QueueSortBy = "severity" | "failed15m" | "pendingNow";

function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SuperAdminDashboard() {
    const [periodMinutes, setPeriodMinutes] = useState(15);
    const [sortBy, setSortBy] = useState<QueueSortBy>("severity");

    const { data, isLoading } = useQuery({
        queryKey: ["sa", "dashboard"],
        queryFn:  () => getDashboardStats(),
        staleTime: 60_000,
    });
    const { data: queueHealthRaw, isLoading: isQueueLoading } = useQuery({
        queryKey: ["sa", "queue-health", periodMinutes],
        queryFn: () => getQueueHealthStats(periodMinutes),
        staleTime: 30_000,
    });
    const queueHealth = useMemo(() => {
        if (!queueHealthRaw) return queueHealthRaw;
        const rows = [...queueHealthRaw.companies].sort((a, b) => compareRows(a, b, sortBy));
        return { ...queueHealthRaw, companies: rows };
    }, [queueHealthRaw, sortBy]);

    const cards = [
        {
            label: "Empresas cadastradas",
            value: isLoading ? "—" : String(data?.totalCompanies ?? 0),
            icon:  Building2,
            href:  "/superadmin/empresas",
            color: "bg-primary/10 text-primary dark:bg-primary/20",
        },
        {
            label: "Pedidos este mês",
            value: isLoading ? "—" : String(data?.ordersThisMonth ?? 0),
            icon:  Receipt,
            href:  "/superadmin/pedidos",
            color: "bg-accent/10 text-accent dark:bg-accent/20",
        },
        {
            label: "Receita este mês",
            value: isLoading ? "—" : formatCurrency(data?.revenueThisMonth ?? 0),
            icon:  TrendingUp,
            href:  "/superadmin/pedidos",
            color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
        },
        {
            label: "Canais WA ativos",
            value: isLoading ? "—" : String(data?.activeChannels ?? 0),
            icon:  MessageSquare,
            href:  "/superadmin/canais",
            color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
        },
        {
            label: "Fila pendente agora",
            value: isQueueLoading ? "—" : String(queueHealth?.summary.pendingNow ?? 0),
            icon: AlertTriangle,
            href: "/superadmin",
            color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        },
        {
            label: "Falhas (15 min)",
            value: isQueueLoading ? "—" : String(queueHealth?.summary.failed15m ?? 0),
            icon: AlertTriangle,
            href: "/superadmin",
            color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
                <p className="text-xs text-zinc-400">Visão geral da plataforma</p>
            </div>

            {/* Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <Link
                            key={card.label}
                            href={card.href}
                            className="group flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-primary/30 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.color}`}>
                                <Icon className="h-5 w-5" />
                            </div>
                            <div>
                                {isLoading ? (
                                    <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
                                ) : (
                                    <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                        {card.value}
                                    </div>
                                )}
                                <div className="mt-0.5 text-xs text-zinc-400">{card.label}</div>
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Saúde da Fila Chatbot
                        </h2>
                        <p className="text-xs text-zinc-400">
                            Falhas, pendências e dedup por empresa
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={String(periodMinutes)}
                            onChange={(e) => setPeriodMinutes(Number(e.target.value))}
                            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                            <option value="15">15m</option>
                            <option value="60">1h</option>
                            <option value="1440">24h</option>
                        </select>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as QueueSortBy)}
                            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                            <option value="severity">Ordenar: severidade</option>
                            <option value="failed15m">Ordenar: falhas</option>
                            <option value="pendingNow">Ordenar: pendências</option>
                        </select>
                    </div>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat
                        label="Failure rate (15m)"
                        value={formatPct(queueHealth?.summary.failureRate ?? 0)}
                        loading={isQueueLoading}
                    />
                    <MiniStat
                        label="Dedup hit rate (15m)"
                        value={formatPct(queueHealth?.summary.dedupHitRate ?? 0)}
                        loading={isQueueLoading}
                    />
                    <MiniStat
                        label={`Processed (${formatPeriodLabel(periodMinutes)})`}
                        value={String(queueHealth?.summary.processed15m ?? 0)}
                        loading={isQueueLoading}
                    />
                    <MiniStat
                        label="Pendentes agora"
                        value={String(queueHealth?.summary.pendingNow ?? 0)}
                        loading={isQueueLoading}
                    />
                </div>

                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Empresa
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Semáforo
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Pending
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Failed 15m
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Failure rate
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                    Dedup hit
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {(queueHealth?.companies ?? []).slice(0, 20).map((c) => (
                                <tr key={c.companyId}>
                                    <td className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">{c.companyName}</td>
                                    <td className="px-3 py-2">
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${semaphoreStyle(c.severity)}`}>
                                            {semaphoreLabel(c.severity)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-xs">{c.pendingNow}</td>
                                    <td className="px-3 py-2 text-xs">{c.failed15m}</td>
                                    <td className="px-3 py-2 text-xs">{formatPct(c.failureRate)}</td>
                                    <td className="px-3 py-2 text-xs">{formatPct(c.dedupHitRate)}</td>
                                </tr>
                            ))}
                            {!isQueueLoading && (queueHealth?.companies?.length ?? 0) === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-zinc-400">
                                        Sem atividade recente na janela monitorada.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Atalhos */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Ações rápidas</h2>
                <div className="flex flex-wrap gap-3">
                    {[
                        { label: "Ver todas as empresas", href: "/superadmin/empresas" },
                        { label: "Ver canais WA",         href: "/superadmin/canais"   },
                        { label: "Ver pedidos",           href: "/superadmin/pedidos"  },
                        { label: "Segurança / ambiente",   href: "/superadmin/seguranca" },
                    ].map((a) => (
                        <Link
                            key={a.href}
                            href={a.href}
                            className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:border-primary hover:text-primary dark:border-zinc-700 dark:text-zinc-400"
                        >
                            {a.label}
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MiniStat({ label, value, loading }: Readonly<{ label: string; value: string; loading: boolean }>) {
    return (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {loading ? "—" : value}
            </div>
        </div>
    );
}

function formatPct(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}

function semaphoreLabel(severity: string): string {
    if (severity === "red") return "Crítico";
    if (severity === "yellow") return "Atenção";
    return "Saudável";
}

function semaphoreStyle(severity: string): string {
    if (severity === "red") {
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    }
    if (severity === "yellow") {
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    }
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
}

function severityWeight(severity: string): number {
    if (severity === "red") return 2;
    if (severity === "yellow") return 1;
    return 0;
}

function compareRows(
    a: { severity: string; failed15m: number; pendingNow: number },
    b: { severity: string; failed15m: number; pendingNow: number },
    sortBy: QueueSortBy
): number {
    if (sortBy === "failed15m") {
        return b.failed15m - a.failed15m || b.pendingNow - a.pendingNow;
    }
    if (sortBy === "pendingNow") {
        return b.pendingNow - a.pendingNow || b.failed15m - a.failed15m;
    }
    return (
        severityWeight(b.severity) - severityWeight(a.severity)
        || b.pendingNow - a.pendingNow
        || b.failed15m - a.failed15m
    );
}

function formatPeriodLabel(minutes: number): string {
    if (minutes === 15) return "15m";
    if (minutes === 60) return "1h";
    if (minutes === 1440) return "24h";
    return `${minutes}m`;
}
