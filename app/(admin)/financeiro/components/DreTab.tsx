"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { brl } from "../lib/format";
import type { DateRange, DreLine, Stats } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Props = {
    companyId: string | null;
    dateRange: DateRange;
    periodLabel: string;
    stats: Stats | null;
    refreshKey: number;
};

export default function DreTab({ companyId, dateRange, periodLabel, stats, refreshKey }: Props) {
    const [rows, setRows] = useState<DreLine[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const qs = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
        const res = await fetch(`/api/admin/financeiro/dre?${qs}`, { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const dreRows = json.rows as DreLine[] | undefined;
        if (res.ok && dreRows && dreRows.length > 0) {
            setRows(dreRows);
        } else if (stats) {
            setRows([
                { account_name: "Vendas (competência)", account_type: "revenue", total: stats.revenue },
                { account_name: "Custo de mercadorias", account_type: "cost", total: stats.cost },
                { account_name: "Despesas operacionais", account_type: "expense", total: stats.expensesPaid },
            ]);
        }
        setLoading(false);
    }, [companyId, dateRange, stats]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    const cogsMissing = Boolean(stats && stats.cost === 0 && stats.revenue > 0);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                        Demonstrativo — {periodLabel}
                    </p>
                    <p className="text-xs text-zinc-400">Resultado gerencial (recebido − CMV snapshot − opex pago)</p>
                </div>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                >
                    <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Atualizar
                </button>
            </div>

            {cogsMissing && (
                <p className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                    CMV zerado neste período — não chame este resultado de lucro real.
                </p>
            )}

            <div className="max-w-2xl overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                {loading ? (
                    <div className="space-y-2 p-5">
                        {[...Array(6)].map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        <div className="bg-zinc-50 px-5 py-2.5 dark:bg-zinc-800/50">
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Receitas</p>
                        </div>
                        {rows
                            .filter((r) => r.account_type === "revenue")
                            .map((r) => (
                                <div key={r.account_name} className="flex items-center justify-between px-5 py-3 text-sm">
                                    <span className="text-zinc-600 dark:text-zinc-400">{r.account_name}</span>
                                    <span className="font-bold text-emerald-600">+ {brl(r.total)}</span>
                                </div>
                            ))}
                        {stats && (
                            <div className="flex items-center justify-between bg-emerald-50 px-5 py-3 text-sm font-black dark:bg-emerald-900/20">
                                <span>Recebido (caixa)</span>
                                <span className="text-base text-emerald-600">{brl(stats.revenue)}</span>
                            </div>
                        )}
                        <div className="bg-zinc-50 px-5 py-2.5 dark:bg-zinc-800/50">
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                Custos e despesas
                            </p>
                        </div>
                        {rows
                            .filter((r) => r.account_type === "cost" || r.account_type === "expense")
                            .map((r) => (
                                <div key={r.account_name} className="flex items-center justify-between px-5 py-3 text-sm">
                                    <span className="text-zinc-600 dark:text-zinc-400">{r.account_name}</span>
                                    <span className="font-bold text-red-500">- {brl(r.total)}</span>
                                </div>
                            ))}
                        {stats && (
                            <div
                                className={`flex items-center justify-between border-t-2 px-5 py-4 text-sm font-black ${
                                    stats.realProfit >= 0
                                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                                        : "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20"
                                }`}
                            >
                                <span className="text-base">Resultado gerencial</span>
                                <span
                                    className={`text-xl ${stats.realProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}
                                >
                                    {brl(stats.realProfit)}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
