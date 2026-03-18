"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
    MessageCircle,
    Package,
    RefreshCcw,
    ShoppingCart,
    TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ─── types ────────────────────────────────────────────────────────────────────

type ChartPoint = {
    hora: string;
    pedidos: number;
    total: number;
};

type TopProduct = {
    name: string;
    qty: number;
};

type StatsData = {
    salesTotal: number;
    ordersToday: number;
    activeOrders: number;
    ticketMedio: number;
    waConversations: number;
    chartData: ChartPoint[];
    topProducts: TopProduct[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function brl(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Tooltip customizado para o gráfico ──────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const pedidos = payload[0]?.value ?? 0;
    const total   = payload[0]?.payload?.total ?? 0;
    return (
        <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <p className="mb-1 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">{label}</p>
            <p className="text-sm font-bold text-primary">{pedidos} pedido{pedidos !== 1 ? "s" : ""}</p>
            {total > 0 && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">R$ {brl(total)}</p>
            )}
        </div>
    );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="rounded-xl border-l-4 border-zinc-200 bg-white p-5 shadow-sm dark:bg-zinc-900 dark:border-zinc-700">
            <div className="flex items-start justify-between">
                <div className="space-y-2">
                    <div className="h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-7 w-32 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800/60" />
                </div>
                <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
            </div>
        </div>
    );
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function DashboardClient() {
    const [data,        setData]        = useState<StatsData | null>(null);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    // flash visual quando chega evento realtime
    const [realtimeFlash, setRealtimeFlash] = useState(false);

    const supabase      = useMemo(() => createClient(), []);
    // debounce: evita múltiplos refreshes em cascata quando chegam vários eventos
    const refreshTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

    async function loadStats(silent = false) {
        if (!silent) setError(null);
        try {
            const res  = await fetch("/api/dashboard/stats", { credentials: "include", cache: "no-store" });
            const json = await res.json();
            if (!res.ok) { setError(json?.error ?? "Erro ao carregar dados"); return; }
            setData(json as StatsData);
            setLastUpdated(new Date());
        } catch {
            if (!silent) setError("Falha de conexão");
        } finally {
            setLoading(false);
        }
    }

    /** Agenda refresh com debounce de 800ms e aciona flash visual */
    function scheduleRealtimeRefresh() {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(async () => {
            await loadStats(true);
            // pisca brevemente os cards para indicar atualização
            setRealtimeFlash(true);
            setTimeout(() => setRealtimeFlash(false), 1200);
        }, 800);
    }

    // Polling de segurança (60s) + refresh inicial
    useEffect(() => {
        loadStats();
        const timer = setInterval(() => loadStats(true), 60_000);
        return () => {
            clearInterval(timer);
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Supabase Realtime — escuta mudanças em orders e order_items
    useEffect(() => {
        const channel = supabase
            .channel("dashboard_realtime")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "orders" },
                scheduleRealtimeRefresh
            )
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "order_items" },
                scheduleRealtimeRefresh
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase]);

    // ── cards config ─────────────────────────────────────────────────────────

    const summaryCards = [
        {
            title:  "Faturamento do Dia",
            value:  data ? `R$ ${brl(data.salesTotal)}` : "—",
            sub:    `${data?.ordersToday ?? 0} pedido${data?.ordersToday !== 1 ? "s" : ""} hoje`,
            icon:   BadgeDollarSign,
            color:  "text-emerald-600 dark:text-emerald-400",
            iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
            border: "border-l-4 border-emerald-500",
        },
        {
            title:  "Pedidos Ativos",
            value:  data ? String(data.activeOrders) : "—",
            sub:    "Novos + Em entrega",
            icon:   ShoppingCart,
            color:  "text-orange-500",
            iconBg: "bg-orange-50 dark:bg-orange-500/10",
            border: "border-l-4 border-orange-400",
        },
        {
            title:  "Ticket Médio",
            value:  data ? `R$ ${brl(data.ticketMedio)}` : "—",
            sub:    "Por pedido hoje",
            icon:   TrendingUp,
            color:  "text-violet-600 dark:text-violet-400",
            iconBg: "bg-violet-50 dark:bg-violet-500/10",
            border: "border-l-4 border-violet-600",
        },
        {
            title:  "Conversas WhatsApp",
            value:  data ? String(data.waConversations) : "—",
            sub:    "Ativas nas últimas 24h",
            icon:   MessageCircle,
            color:  "text-sky-600 dark:text-sky-400",
            iconBg: "bg-sky-50 dark:bg-sky-500/10",
            border: "border-l-4 border-sky-400",
        },
    ] as const;

    const maxQty = data?.topProducts?.[0]?.qty ?? 1;

    return (
        <div className="flex flex-col gap-6">

            {/* ── cabeçalho ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Centro de Comando</h1>
                        {/* Indicador Realtime */}
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

            {/* ── 4 cards de resumo ─────────────────────────────────────── */}
            <div className={`grid grid-cols-2 gap-4 transition-all duration-500 lg:grid-cols-4 ${realtimeFlash ? "scale-[1.005]" : ""}`}>
                {loading
                    ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                    : summaryCards.map((card) => {
                          const Icon = card.icon;
                          return (
                              <div
                                  key={card.title}
                                  className={`rounded-xl bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${card.border} ${realtimeFlash ? "ring-2 ring-emerald-300/60 dark:ring-emerald-600/40" : ""}`}
                              >
                                  <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{card.title}</p>
                                          <p className="mt-1 truncate text-2xl font-bold text-zinc-900 dark:text-zinc-50">{card.value}</p>
                                          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{card.sub}</p>
                                      </div>
                                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconBg}`}>
                                          <Icon className={`h-5 w-5 ${card.color}`} />
                                      </span>
                                  </div>
                              </div>
                          );
                      })}
            </div>

            {/* ── gráfico + top produtos ─────────────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-3">

                {/* AreaChart 24h */}
                <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900 lg:col-span-2">
                    <div className="mb-5 flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Volume de Pedidos</h2>
                            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Últimas 24 horas — agrupado por hora</p>
                        </div>
                        {!loading && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary dark:bg-primary/20 dark:text-purple-300">
                                {(data?.chartData ?? []).reduce((s, d) => s + d.pedidos, 0)} pedidos
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div className="h-56 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
                    ) : (
                        <ResponsiveContainer width="100%" height={224}>
                            <AreaChart
                                data={data?.chartData ?? []}
                                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                            >
                                <defs>
                                    <linearGradient id="gradPedidos" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#4c1d95" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#4c1d95" stopOpacity={0.02} />
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
                                    allowDecimals={false}
                                    width={24}
                                />
                                <Tooltip content={<ChartTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="pedidos"
                                    stroke="#4c1d95"
                                    strokeWidth={2.5}
                                    fill="url(#gradPedidos)"
                                    dot={false}
                                    activeDot={{ r: 5, strokeWidth: 0, fill: "#4c1d95" }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Top 5 produtos */}
                <div className="flex flex-col rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-500/10">
                            <Package className="h-4 w-4 text-accent" />
                        </span>
                        <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Produtos Populares</h2>
                    </div>
                    <p className="mb-5 text-xs text-zinc-400 dark:text-zinc-500">Top 5 mais vendidos — últimos 30 dias</p>

                    {loading ? (
                        <div className="space-y-5">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="space-y-1.5">
                                    <div className="h-3 w-36 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                                    <div className="h-2 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                </div>
                            ))}
                        </div>
                    ) : (data?.topProducts ?? []).length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center text-center">
                            <Package className="mb-2 h-8 w-8 text-zinc-200 dark:text-zinc-700" />
                            <p className="text-xs text-zinc-400">Nenhuma venda registrada nos últimos 30 dias.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {(data?.topProducts ?? []).map((p, idx) => {
                                const pct = Math.round((p.qty / maxQty) * 100);
                                return (
                                    <div key={p.name}>
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                                    idx === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" :
                                                    idx === 1 ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" :
                                                    idx === 2 ? "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400" :
                                                    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                                }`}>
                                                    {idx + 1}
                                                </span>
                                                <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                                    {p.name}
                                                </span>
                                            </div>
                                            <span className="shrink-0 text-xs font-bold text-accent">{p.qty}×</span>
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

            {/* ── linha de faturamento do gráfico (R$) ──────────────────── */}
            {!loading && (data?.chartData ?? []).some((d) => d.total > 0) && (
                <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                    <div className="mb-5 flex items-start justify-between">
                        <div>
                            <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Faturamento por Hora</h2>
                            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">R$ acumulado por hora — últimas 24h</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                            R$ {brl((data?.chartData ?? []).reduce((s, d) => s + d.total, 0))}
                        </span>
                    </div>
                    <ResponsiveContainer width="100%" height={160}>
                        <AreaChart
                            data={data?.chartData ?? []}
                            margin={{ top: 4, right: 8, bottom: 0, left: 16 }}
                        >
                            <defs>
                                <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" strokeOpacity={0.6} vertical={false} />
                            <XAxis dataKey="hora" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} interval={3} />
                            <YAxis
                                tick={{ fontSize: 10, fill: "#a1a1aa" }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                                width={40}
                            />
                            <Tooltip
                                content={({ active, payload, label }: any) => {
                                    if (!active || !payload?.length) return null;
                                    return (
                                        <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                                            <p className="mb-1 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">{label}</p>
                                            <p className="text-sm font-bold text-emerald-600">R$ {brl(payload[0]?.value ?? 0)}</p>
                                        </div>
                                    );
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="total"
                                stroke="#10b981"
                                strokeWidth={2.5}
                                fill="url(#gradTotal)"
                                dot={false}
                                activeDot={{ r: 5, strokeWidth: 0, fill: "#10b981" }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
