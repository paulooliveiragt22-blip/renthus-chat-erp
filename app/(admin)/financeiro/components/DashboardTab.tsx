"use client";

import { useMemo } from "react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { useTheme } from "next-themes";
import {
    BadgeDollarSign, ShoppingCart, TrendingUp, TrendingDown,
    Wallet, CreditCard, Banknote, QrCode, ChevronDown,
} from "lucide-react";
import { FINANCE_ORIGINS, ORIGIN_LABELS } from "@/src/financeiro/domain/origin";
import { brl, pct } from "../lib/format";
import type { ExpenseRow, FinanceTab, Stats } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Props = {
    stats: Stats | null;
    expenses: ExpenseRow[];
    loading: boolean;
    periodLabel: string;
    onGoTab: (tab: FinanceTab) => void;
};

function BarTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ dataKey?: string; value?: number }>;
    label?: string;
}) {
    if (!active || !payload?.length) return null;
    const revenue = payload.find((p) => p.dataKey === "revenue")?.value ?? 0;
    const realProfit = payload.find((p) => p.dataKey === "realProfit")?.value ?? 0;
    const expensesDay = payload.find((p) => p.dataKey === "expensesDay")?.value ?? 0;
    return (
        <div className="min-w-[140px] space-y-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="mb-1 font-bold text-zinc-700 dark:text-zinc-200">{label}</p>
            <p className="text-violet-600">Recebido: <b>{brl(revenue)}</b></p>
            {realProfit > 0 && <p className="text-emerald-600">Resultado: <b>{brl(realProfit)}</b></p>}
            {expensesDay > 0 && <p className="text-red-500">Opex: <b>{brl(expensesDay)}</b></p>}
        </div>
    );
}

export default function DashboardTab({ stats, expenses, loading, periodLabel, onGoTab }: Props) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const chartColor = isDark ? "#7599ad" : "#16364D";
    const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
    const axisColor = isDark ? "#71717a" : "#a1a1aa";
    const realMargin = stats && stats.revenue > 0 ? (stats.realProfit / stats.revenue) * 100 : 0;
    const cogsMissing = Boolean(stats && stats.cost === 0 && stats.revenue > 0);

    const expensePieData = useMemo(() => {
        const catMap: Record<string, number> = {};
        expenses.forEach((e) => {
            catMap[e.category] = (catMap[e.category] ?? 0) + Number(e.amount);
        });
        const COLORS = ["#16364D", "#57ff8f", "#22c55e", "#0ea5e9", "#f43f5e", "#2a5570", "#eab308"];
        return Object.entries(catMap).map(([name, value], i) => ({
            name,
            value,
            fill: COLORS[i % COLORS.length],
        }));
    }, [expenses]);

    const realProfitData = useMemo(() => {
        if (!stats) return [];
        return stats.byDay.map((d) => ({
            ...d,
            realProfit: Math.max(0, d.revenue - d.cost),
            expensesDay: d.expensesDay,
        }));
    }, [stats]);

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                    {
                        icon: BadgeDollarSign,
                        label: "Recebido",
                        value: stats ? brl(stats.revenue) : "—",
                        sub: `${stats?.orders ?? 0} liquidações (caixa 1.1)`,
                        bg: "bg-violet-100 dark:bg-violet-900/30",
                        ic: "text-violet-600",
                        tab: "extrato" as FinanceTab,
                        title: "Ver extrato",
                    },
                    {
                        icon: Wallet,
                        label: "A receber",
                        value: stats ? brl(stats.totalAReceber) : "—",
                        sub: "títulos em aberto",
                        bg: "bg-emerald-100 dark:bg-emerald-900/30",
                        ic: "text-emerald-600",
                        tab: "receber" as FinanceTab,
                        title: "Ver contas a receber",
                    },
                    {
                        icon: TrendingDown,
                        label: "Opex pago",
                        value: stats ? brl(stats.expensesPaid) : "—",
                        sub: `${expenses.filter((e) => e.payment_status === "paid").length} no período`,
                        bg: "bg-red-100 dark:bg-red-900/30",
                        ic: "text-red-500",
                        tab: "pagar" as FinanceTab,
                        title: "Ver contas a pagar",
                    },
                    {
                        icon: TrendingUp,
                        label: "Resultado gerencial",
                        value: stats ? brl(stats.realProfit) : "—",
                        sub: stats && stats.revenue > 0 ? `Margem ${pct(realMargin)}` : "recebido − CMV − opex",
                        bg: "bg-orange-100 dark:bg-orange-900/30",
                        ic: "text-orange-500",
                        tab: null,
                        title: null,
                    },
                ].map(({ icon: Icon, label, value, sub, bg, ic, tab, title }) => (
                    <button
                        key={label}
                        type="button"
                        onClick={() => tab && onGoTab(tab)}
                        title={title ?? undefined}
                        className={`flex w-full items-center gap-4 rounded-xl bg-white p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${tab ? "cursor-pointer hover:ring-2 hover:ring-violet-200 dark:hover:ring-violet-800" : "cursor-default"}`}
                    >
                        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                            <Icon className={`h-5 w-5 ${ic}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-zinc-400">{label}</p>
                            {loading ? (
                                <Skeleton className="mt-1 h-7 w-28" />
                            ) : (
                                <p className="truncate text-xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
                            )}
                            <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>
                        </div>
                        {tab && <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-zinc-300 dark:text-zinc-600" />}
                    </button>
                ))}
            </div>

            {cogsMissing && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                    CMV do período está zerado. Este número é resultado gerencial, não lucro contábil — cadastre
                    o preço de custo nas embalagens para o snapshot passar a preencher.
                </p>
            )}

            {stats && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                    {FINANCE_ORIGINS.map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onGoTab("extrato")}
                            className="rounded-xl bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900"
                        >
                            <p className="text-[10px] text-zinc-400">{ORIGIN_LABELS[key]}</p>
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                {brl(stats.byOrigin[key] ?? 0)}
                            </p>
                        </button>
                    ))}
                </div>
            )}

            <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                            Caixa por dia — {periodLabel}
                        </p>
                        <p className="text-xs text-zinc-400">Roxo = recebido 1.1 · Verde = resultado estimado</p>
                    </div>
                    {stats && (
                        <span className="rounded-full bg-violet-100 px-3 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            {brl(stats.revenue)}
                        </span>
                    )}
                </div>
                {loading ? (
                    <Skeleton className="h-[220px] w-full" />
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={realProfitData} barCategoryGap="30%">
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: axisColor }}
                                axisLine={false}
                                tickLine={false}
                                interval={stats && stats.byDay.length > 14 ? Math.floor(stats.byDay.length / 7) : 0}
                            />
                            <YAxis
                                tickFormatter={(v) => `R$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`}
                                tick={{ fontSize: 11, fill: axisColor }}
                                axisLine={false}
                                tickLine={false}
                                width={52}
                            />
                            <Tooltip content={<BarTooltip />} cursor={{ fill: isDark ? "#3f3f4650" : "#f4f4f550" }} />
                            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={36} fill={chartColor} opacity={0.9} />
                            <Bar dataKey="realProfit" radius={[4, 4, 0, 0]} maxBarSize={36} fill="#22c55e" opacity={0.75} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-violet-600" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Formas de pagamento</p>
                    </div>
                    {loading ? (
                        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                    ) : !stats?.byPay.length ? (
                        <p className="py-8 text-center text-sm text-zinc-400">Sem dados.</p>
                    ) : (
                        <div className="space-y-3">
                            {stats.byPay.map(({ method, label, color, total, count }) => {
                                const share = stats.revenue > 0 ? (total / stats.revenue) * 100 : 0;
                                const Icon = method === "pix" ? QrCode : method === "card" ? CreditCard : Banknote;
                                return (
                                    <div key={method}>
                                        <div className="mb-1 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Icon className="h-4 w-4" style={{ color }} />
                                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
                                                <span className="text-xs text-zinc-400">({count})</span>
                                            </div>
                                            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{brl(total)}</span>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Análise de resultado</p>
                    </div>
                    {loading ? (
                        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                    ) : (
                        <div className="space-y-3">
                            {[
                                { label: "Recebido (caixa)", value: stats?.revenue ?? 0, color: "#16364D", textCls: "text-violet-600", icon: BadgeDollarSign },
                                { label: "CMV snapshot", value: stats?.cost ?? 0, color: "#f43f5e", textCls: "text-red-500", icon: ShoppingCart },
                                { label: "Opex pago", value: stats?.expensesPaid ?? 0, color: "#57ff8f", textCls: "text-orange-500", icon: TrendingDown },
                                { label: "Resultado gerencial", value: stats?.realProfit ?? 0, color: "#22c55e", textCls: "text-emerald-600", icon: TrendingUp },
                            ].map(({ label, value, color, textCls, icon: Icon }) => {
                                const share = (stats?.revenue ?? 1) > 0 ? Math.min((Math.abs(value) / (stats?.revenue ?? 1)) * 100, 100) : 0;
                                return (
                                    <div key={label} className="rounded-xl border border-zinc-100 p-3 dark:border-zinc-800">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Icon className={`h-4 w-4 ${textCls}`} />
                                                <p className="text-xs text-zinc-500">{label}</p>
                                            </div>
                                            <p className={`text-sm font-bold ${textCls}`}>{brl(value)}</p>
                                        </div>
                                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                    <div className="mb-4 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Opex por categoria</p>
                    </div>
                    {expensePieData.length === 0 ? (
                        <p className="py-8 text-center text-xs text-zinc-400">Nenhuma despesa no período.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie
                                    data={expensePieData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={70}
                                    label={({ name, percent }: { name?: string; percent?: number }) =>
                                        `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                                    }
                                    labelLine={false}
                                >
                                    {expensePieData.map((entry, i) => (
                                        <Cell key={i} fill={entry.fill} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(v: number) => brl(Number(v))} />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                    <Wallet className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Detalhamento por dia</p>
                    <span className="ml-auto text-xs text-zinc-400">{periodLabel}</span>
                </div>
                {loading ? (
                    <div className="space-y-px p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : !stats?.byDay.filter((d) => d.orders > 0).length ? (
                    <p className="py-16 text-center text-sm text-zinc-400">Nenhuma liquidação no período.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="min-w-[480px] divide-y divide-zinc-100 dark:divide-zinc-800">
                        <div className="grid grid-cols-4 gap-4 bg-zinc-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/50">
                            <span>Data</span>
                            <span className="text-right">Lançamentos</span>
                            <span className="text-right">Recebido</span>
                            <span className="text-right">Resultado est.</span>
                        </div>
                        {stats.byDay
                            .filter((d) => d.orders > 0)
                            .reverse()
                            .map((d) => (
                                <div key={d.isoDate} className="grid grid-cols-4 gap-4 px-5 py-3">
                                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{d.label}</p>
                                    <p className="text-right text-sm text-zinc-500">{d.orders}</p>
                                    <p className="text-right text-sm font-bold text-violet-600">{brl(d.revenue)}</p>
                                    <p className={`text-right text-sm font-bold ${d.cost > 0 ? "text-emerald-600" : "text-zinc-300 dark:text-zinc-600"}`}>
                                        {d.cost > 0 ? brl(d.revenue - d.cost) : "—"}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
