"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    Activity,
    AlertTriangle,
    Building2,
    Loader2,
    MessageSquare,
    Receipt,
    ShieldAlert,
    TrendingUp,
} from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import PlatformOrdersFiltersBar from "@/components/platform/PlatformOrdersFiltersBar";
import {
    ordersFilterQueryString,
    parseOrdersFilterFromSearchParams,
    type PlatformOrdersFilter,
} from "@/lib/platform/ordersFilters";
import { companiesOptionsQueryString } from "@/lib/platform/companiesFilters";

function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PlatformDashboard() {
    const searchParams = useSearchParams();
    const [orderFilters, setOrderFilters] = useState<PlatformOrdersFilter>(() =>
        parseOrdersFilterFromSearchParams(
            new URLSearchParams(searchParams?.toString() ?? "")
        )
    );
    const orderFilterQuery = useMemo(
        () => ordersFilterQueryString(orderFilters),
        [orderFilters]
    );

    const { data: companiesData } = useQuery({
        queryKey: ["platform", "companies"],
        queryFn: () => platformApi.companies(companiesOptionsQueryString()),
        staleTime: 60_000,
    });
    const companies = useMemo(
        () =>
            ((companiesData?.companies ?? []) as Array<{ id: string; name: string }>).map(
                (c) => ({ id: c.id, name: c.name })
            ),
        [companiesData]
    );

    const { data, isLoading } = useQuery({
        queryKey: ["platform", "dashboard", orderFilterQuery],
        queryFn: () => platformApi.metrics("dashboard", orderFilterQuery),
        staleTime: 60_000,
        refetchInterval: 60_000,
    });

    const { data: opsSnapshot } = useQuery({
        queryKey: ["platform", "ops-snapshot", 15],
        queryFn: () => platformApi.metrics("ops", { minutes: 15 }),
        staleTime: 30_000,
        refetchInterval: 30_000,
    });

    const { data: alertsData } = useQuery({
        queryKey: ["platform", "alerts"],
        queryFn: () => platformApi.alerts(),
        staleTime: 30_000,
        refetchInterval: 30_000,
    });

    const ordersCount = data?.ordersCount ?? data?.ordersThisMonth ?? 0;
    const revenue = data?.revenue ?? data?.revenueThisMonth ?? 0;
    const firing =
        alertsData?.alerts.filter(
            (a) => a.severity === "critical" || a.severity === "warning"
        ) ?? [];

    const cards = [
        {
            label: "Empresas cadastradas",
            value: isLoading ? "—" : String(data?.totalCompanies ?? 0),
            icon: Building2,
            href: "/platform/empresas",
            color: "bg-primary/10 text-primary dark:bg-primary/20",
        },
        {
            label: "Pedidos (filtro)",
            value: isLoading ? "—" : String(ordersCount),
            icon: Receipt,
            href: `/platform/pedidos${orderFilterQuery ? `?${orderFilterQuery}` : ""}`,
            color: "bg-accent/10 text-accent dark:bg-accent/20",
        },
        {
            label: "Receita (filtro)",
            value: isLoading ? "—" : formatCurrency(revenue),
            icon: TrendingUp,
            href: `/platform/pedidos${orderFilterQuery ? `?${orderFilterQuery}` : ""}`,
            color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
        },
        {
            label: "Canais WA ativos",
            value: isLoading ? "—" : String(data?.activeChannels ?? 0),
            icon: MessageSquare,
            href: "/platform/canais",
            color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
        },
        {
            label: "Backlog chatbot",
            value: String(
                opsSnapshot?.queue.summary.backlogTotal ??
                    opsSnapshot?.queue.summary.pendingNow ??
                    "—"
            ),
            icon: Activity,
            href: "/platform/observabilidade",
            color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
        },
        {
            label: "Alertas ops",
            value: firing.length ? String(firing.length) : "0",
            icon: firing.length ? AlertTriangle : ShieldAlert,
            href: "/platform/observabilidade",
            color: firing.length
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
                <p className="text-xs text-zinc-400">
                    KPIs de negócio — fila, pipeline PRO e alertas em Observabilidade
                </p>
            </div>

            {firing.length > 0 && (
                <Link
                    href="/platform/observabilidade"
                    className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:border-amber-300 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                        <p className="font-semibold">
                            {firing.length} alerta(s) operacional(is) ativo(s)
                        </p>
                        <p className="mt-0.5 text-xs opacity-90">
                            {firing[0]?.title}
                            {firing.length > 1 ? ` (+${firing.length - 1})` : ""} — abrir
                            Observabilidade
                        </p>
                    </div>
                </Link>
            )}

            <PlatformOrdersFiltersBar
                value={orderFilters}
                onChange={setOrderFilters}
                companies={companies}
                summary={
                    data
                        ? {
                              ordersCount,
                              revenue,
                              revenueNote: data.revenueNote ?? null,
                          }
                        : undefined
                }
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <Link
                            key={card.label}
                            href={card.href}
                            className="group flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-primary/30 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <div
                                className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.color}`}
                            >
                                <Icon className="h-5 w-5" />
                            </div>
                            <div>
                                {isLoading && card.label.startsWith("Empresa") ? (
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
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Ações rápidas
                </h2>
                <div className="flex flex-wrap gap-3">
                    {[
                        { label: "Observabilidade (fila + PRO)", href: "/platform/observabilidade" },
                        { label: "Empresas", href: "/platform/empresas" },
                        { label: "Canais WA", href: "/platform/canais" },
                        { label: "Pedidos", href: "/platform/pedidos" },
                        { label: "Segurança", href: "/platform/seguranca" },
                    ].map((a) => (
                        <Link
                            key={a.href}
                            href={a.href}
                            className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-400"
                        >
                            {a.label}
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
