"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import {
    BadgeDollarSign,
    HandCoins,
    Package,
    RefreshCcw,
    ShoppingCart,
    Sparkles,
    TrendingUp,
    Zap,
} from "lucide-react";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";
import { Skeleton } from "@/components/ui/skeleton";

// ─── types ────────────────────────────────────────────────────────────────────

type ChartPoint = {
    hora: string;
    caixa: number;
    pedidos: number;
};

type TopProduct = {
    name: string;
    qty: number;
};

type StatsData = {
    salesTotal: number;
    arOpen: number;
    ordersToday: number;
    settledSalesToday: number;
    activeOrders: number;
    ticketMedio: number;
    waConversations: number;
    chartData: ChartPoint[];
    topProducts: TopProduct[];
    revenueSource?: string;
    timeZone?: string;
    day?: string;
};

type PlanData = {
    plan_key: string;
    plan_name: string | null;
    used: number;
    limit: number | null;
} | null;

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dayLabel(iso: string | undefined): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
}

// ─── Tooltip customizado para o gráfico ──────────────────────────────────────

function ChartTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ value?: number; payload?: ChartPoint }>;
    label?: string;
}) {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    const caixa = point?.caixa ?? payload[0]?.value ?? 0;
    const pedidos = point?.pedidos ?? 0;
    return (
        <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <p className="mb-1 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">{label}</p>
            <p className="text-sm font-bold text-emerald-600">R$ {brl(Number(caixa))}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {pedidos} pedido{pedidos !== 1 ? "s" : ""} criado{pedidos !== 1 ? "s" : ""} (não é faturamento)
            </p>
        </div>
    );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="rounded-xl border-l-4 border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-24 bg-zinc-100 dark:bg-zinc-800" />
                    <Skeleton className="h-7 w-32 rounded-md bg-zinc-100 dark:bg-zinc-800" rounded="md" />
                    <Skeleton className="h-2.5 w-20 bg-zinc-50 dark:bg-zinc-800/60" />
                </div>
                <Skeleton className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800" />
            </div>
        </div>
    );
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function DashboardClient() {
    const [data, setData] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [planData, setPlanData] = useState<PlanData>(null);
    const [realtimeFlash, setRealtimeFlash] = useState(false);

    const planFeatures = usePlanFeatures();
    const canOpenFinanceiro = planFeatures.has("financeiro_full");

    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    async function loadStats(silent = false) {
        if (!silent) setError(null);
        try {
            const res = await fetch("/api/dashboard/stats", {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json();
            if (!res.ok) {
                setError(json?.error ?? "Erro ao carregar dados");
                return;
            }
            setData(json as StatsData);
            setLastUpdated(new Date());
            if (silent) {
                setRealtimeFlash(true);
                if (refreshTimer.current) clearTimeout(refreshTimer.current);
                refreshTimer.current = setTimeout(() => setRealtimeFlash(false), 1200);
            }
        } catch {
            if (!silent) setError("Falha de conexão");
        } finally {
            setLoading(false);
        }
    }

    async function loadPlanData() {
        try {
            const res = await fetch("/api/billing/status", {
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return;
            const json = await res.json();
            const sub = json?.subscription;
            const wa = json?.usage?.whatsapp_messages;
            if (!sub) return;
            setPlanData({
                plan_key: sub.plan_key ?? "",
                plan_name: sub.plan_name ?? null,
                used: wa?.used ?? 0,
                limit: wa?.limit_per_month ?? null,
            });
        } catch {
            /* silently ignore */
        }
    }

    useEffect(() => {
        void loadStats();
        void loadPlanData();
        // Poll canônico: `orders`/`order_items` estão na publication, mas RLS
        // service_role_only impede postgres_changes no browser autenticado.
        const timer = setInterval(() => {
            if (document.hidden) return;
            void loadStats(true);
        }, 15_000);
        return () => {
            clearInterval(timer);
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const financeHref =
        data?.day != null ? `/financeiro?from=${data.day}&to=${data.day}` : "/financeiro";

    const summaryCards = [
        {
            id: "recebido",
            title: "Recebido hoje",
            value: data ? `R$ ${brl(data.salesTotal)}` : "—",
            sub: data?.day
                ? `Caixa 1.1 · ${dayLabel(data.day)}${
                      data.ordersToday > 0 ? ` · ${data.ordersToday} pedido(s) criados` : ""
                  }`
                : "Caixa postado no dia civil da loja",
            icon: BadgeDollarSign,
            color: "text-emerald-600 dark:text-emerald-400",
            iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
            border: "border-l-4 border-emerald-500",
            href: canOpenFinanceiro ? financeHref : null,
            titleAttr: canOpenFinanceiro
                ? "Abrir Financeiro neste dia"
                : "Recebido no caixa hoje",
        },
        {
            id: "ar",
            title: "A receber",
            value: data ? `R$ ${brl(data.arOpen ?? 0)}` : "—",
            sub: "Títulos em aberto",
            icon: HandCoins,
            color: "text-amber-600 dark:text-amber-400",
            iconBg: "bg-amber-50 dark:bg-amber-500/10",
            border: "border-l-4 border-amber-400",
            href: null as string | null,
            titleAttr: undefined as string | undefined,
        },
        {
            id: "ativos",
            title: "Pedidos ativos",
            value: data ? String(data.activeOrders) : "—",
            sub: "Novos + Em preparo + Entrega",
            icon: ShoppingCart,
            color: "text-orange-500",
            iconBg: "bg-orange-50 dark:bg-orange-500/10",
            border: "border-l-4 border-orange-400",
            href: null as string | null,
            titleAttr: undefined as string | undefined,
        },
        {
            id: "ticket",
            title: "Ticket médio",
            value: data ? `R$ ${brl(data.ticketMedio)}` : "—",
            sub: data
                ? `${data.settledSalesToday} venda${data.settledSalesToday !== 1 ? "s" : ""} liquidada${
                      data.settledSalesToday !== 1 ? "s" : ""
                  }`
                : "Recebido ÷ vendas liquidadas",
            icon: TrendingUp,
            color: "text-violet-600 dark:text-violet-400",
            iconBg: "bg-violet-50 dark:bg-violet-500/10",
            border: "border-l-4 border-violet-600",
            href: null as string | null,
            titleAttr: undefined as string | undefined,
        },
    ] as const;

    const maxQty = data?.topProducts?.[0]?.qty ?? 1;
    const caixa24h = (data?.chartData ?? []).reduce((s, d) => s + (d.caixa ?? 0), 0);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                            Centro de Comando
                        </h1>
                        <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 dark:border-emerald-700/50 dark:bg-emerald-900/20">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                Ao vivo
                            </span>
                        </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                        {lastUpdated
                            ? `Última atualização: ${lastUpdated.toLocaleTimeString("pt-BR")}`
                            : "Carregando dados..."}
                        {data?.timeZone
                            ? ` · Fuso ${data.timeZone}${
                                  data.day ? ` · Dia civil ${dayLabel(data.day)}` : ""
                              }`
                            : ""}
                    </p>
                </div>
                <button
                    onClick={() => loadStats()}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                >
                    <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            <div
                className={`grid grid-cols-2 gap-4 transition-all duration-500 lg:grid-cols-4 ${
                    realtimeFlash ? "scale-[1.005]" : ""
                }`}
            >
                {loading
                    ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                    : summaryCards.map((card) => {
                          const Icon = card.icon;
                          const body = (
                              <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                          {card.title}
                                      </p>
                                      <p className="mt-1 truncate text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                                          {card.value}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                                          {card.sub}
                                      </p>
                                  </div>
                                  <span
                                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconBg}`}
                                  >
                                      <Icon className={`h-5 w-5 ${card.color}`} />
                                  </span>
                              </div>
                          );
                          const className = `rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${card.border} ${
                              realtimeFlash ? "ring-2 ring-emerald-300/60 dark:ring-emerald-600/40" : ""
                          } ${card.href ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" : ""}`;

                          if (card.href) {
                              return (
                                  <Link
                                      key={card.id}
                                      href={card.href}
                                      title={card.titleAttr}
                                      className={className}
                                  >
                                      {body}
                                  </Link>
                              );
                          }

                          return (
                              <div key={card.id} className={className} title={card.titleAttr}>
                                  {body}
                              </div>
                          );
                      })}
            </div>

            {planData &&
                (() => {
                    const planKey = String(planData.plan_key ?? "").toLowerCase();
                    const isPaidTier =
                        planKey === "pro" || planKey === "market" || planKey === "complete";
                    const pct = planData.limit
                        ? Math.min(100, Math.round((planData.used / planData.limit) * 100))
                        : 0;
                    const barColor =
                        pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";
                    return (
                        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-100 bg-white px-5 py-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="flex shrink-0 items-center gap-2">
                                {isPaidTier ? (
                                    <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                ) : (
                                    <Sparkles className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                                )}
                                <span
                                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                                        isPaidTier
                                            ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                                            : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                                    }`}
                                >
                                    {planData.plan_name ?? planData.plan_key}
                                </span>
                            </div>

                            <div className="hidden h-5 w-px bg-zinc-200 dark:bg-zinc-700 sm:block" />

                            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                        Mensagens WhatsApp — mês atual
                                        {data != null
                                            ? ` · ${data.waConversations} conversa(s) 24h`
                                            : ""}
                                    </span>
                                    <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                                        {planData.used.toLocaleString("pt-BR")}
                                        {planData.limit != null &&
                                            ` / ${planData.limit.toLocaleString("pt-BR")}`}
                                    </span>
                                </div>
                                {planData.limit != null && (
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                )}
                            </div>

                            <a
                                href="/configuracoes?tab=plano"
                                className="shrink-0 text-[11px] font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400"
                            >
                                Ver plano →
                            </a>
                        </div>
                    );
                })()}

            <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 lg:col-span-2">
                    <div className="mb-5 flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                                Caixa recebido
                            </h2>
                            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                                Conta 1.1 postada — últimas 24h (fuso da loja). Pedidos criados só no
                                tooltip.
                            </p>
                        </div>
                        {!loading && (
                            <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                R$ {brl(caixa24h)}
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <Skeleton className="h-56 rounded-xl bg-zinc-100 dark:bg-zinc-800" />
                    ) : (
                        <ResponsiveContainer width="100%" height={224}>
                            <AreaChart
                                data={data?.chartData ?? []}
                                margin={{ top: 4, right: 8, bottom: 0, left: 16 }}
                            >
                                <defs>
                                    <linearGradient id="gradCaixa" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e4e4e7"
                                    strokeOpacity={0.6}
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="hora"
                                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                                    tickLine={false}
                                    axisLine={false}
                                    interval={3}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v: number) =>
                                        v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
                                    }
                                    width={40}
                                />
                                <Tooltip content={<ChartTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="caixa"
                                    stroke="#10b981"
                                    strokeWidth={2.5}
                                    fill="url(#gradCaixa)"
                                    dot={false}
                                    activeDot={{ r: 5, strokeWidth: 0, fill: "#10b981" }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                <div className="flex flex-col rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-500/10">
                            <Package className="h-4 w-4 text-accent" />
                        </span>
                        <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                            Produtos populares
                        </h2>
                    </div>
                    <p className="mb-5 text-xs text-zinc-400 dark:text-zinc-500">
                        Top 5 em vendas liquidadas — últimos 30 dias
                    </p>

                    {loading ? (
                        <div className="space-y-5">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="space-y-1.5">
                                    <Skeleton className="h-3 w-36 bg-zinc-100 dark:bg-zinc-800" />
                                    <Skeleton
                                        className="h-2 w-full bg-zinc-100 dark:bg-zinc-800"
                                        rounded="full"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (data?.topProducts ?? []).length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center text-center">
                            <Package className="mb-2 h-8 w-8 text-zinc-200 dark:text-zinc-700" />
                            <p className="text-xs text-zinc-400">
                                Nenhuma venda liquidada nos últimos 30 dias.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {(data?.topProducts ?? []).map((p, idx) => {
                                const pct = Math.round((p.qty / maxQty) * 100);
                                return (
                                    <div key={p.name}>
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span
                                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                                        idx === 0
                                                            ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                                                            : idx === 1
                                                              ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                                                              : idx === 2
                                                                ? "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400"
                                                                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                                    }`}
                                                >
                                                    {idx + 1}
                                                </span>
                                                <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                                    {p.name}
                                                </span>
                                            </div>
                                            <span className="shrink-0 text-xs font-bold text-accent">
                                                {p.qty}×
                                            </span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div
                                                className="h-full rounded-full bg-accent transition-all duration-700"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
