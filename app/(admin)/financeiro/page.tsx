"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ArrowDownCircle,
    ArrowUpCircle,
    BadgeDollarSign,
    Banknote,
    Calendar,
    FileText,
    RefreshCcw,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import PlanFeatureGate from "@/components/billing/PlanFeatureGate";
import { useFinancePeriod, type Period } from "./hooks/useFinancePeriod";
import type { ExpenseRow, FinanceTab, Stats } from "./lib/types";
import DashboardTab from "./components/DashboardTab";
import ExtratoTab from "./components/ExtratoTab";
import ReceberTab from "./components/ReceberTab";
import PagarTab from "./components/PagarTab";
import CaixaTab from "./components/CaixaTab";
import DreTab from "./components/DreTab";

export default function FinanceiroPage() {
    const { currentCompanyId: companyId } = useWorkspace();
    const {
        period,
        setPeriod,
        customFrom,
        setCustomFrom,
        customTo,
        setCustomTo,
        dateRange,
        periodLabel,
        customInvalid,
    } = useFinancePeriod();

    const [activeTab, setActiveTab] = useState<FinanceTab>("dashboard");
    const [refreshKey, setRefreshKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<Stats | null>(null);
    const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

    const loadDashboard = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const qs = new URLSearchParams({
            from: dateRange.from,
            to: dateRange.to,
            days: String(dateRange.days),
        });
        const res = await fetch(`/api/admin/financeiro/dashboard?${qs}`, {
            credentials: "include",
            cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setStats(null);
            setExpenses([]);
            setLoading(false);
            return;
        }
        setStats(json.stats as Stats);
        setExpenses((json.expenses ?? []) as ExpenseRow[]);
        setLoading(false);
    }, [companyId, dateRange]);

    useEffect(() => {
        loadDashboard();
    }, [loadDashboard, refreshKey]);

    function refresh() {
        setRefreshKey((k) => k + 1);
        if (activeTab === "dashboard" || activeTab === "dre") loadDashboard();
    }

    const tabs: Array<{ id: FinanceTab; label: string; short: string; icon: typeof BadgeDollarSign; active: string }> = [
        { id: "dashboard", label: "Dashboard", short: "Home", icon: BadgeDollarSign, active: "text-violet-700 dark:text-violet-400" },
        { id: "extrato", label: "Extrato", short: "Extrato", icon: FileText, active: "text-violet-700 dark:text-violet-400" },
        { id: "receber", label: "A Receber", short: "Receber", icon: ArrowDownCircle, active: "text-emerald-700 dark:text-emerald-400" },
        { id: "pagar", label: "A Pagar", short: "Pagar", icon: ArrowUpCircle, active: "text-red-700 dark:text-red-400" },
        { id: "caixa", label: "Caixa", short: "Caixa", icon: Banknote, active: "text-orange-700 dark:text-orange-400" },
        { id: "dre", label: "DRE", short: "DRE", icon: FileText, active: "text-violet-700 dark:text-violet-400" },
    ];

    return (
        <PlanFeatureGate
            featureKey="financeiro_full"
            title="Financeiro completo"
            description="Recebido, a receber, opex, extrato e resultado gerencial do período."
            requiredPlanLabel="Pro ou Market"
        >
            <div className="flex min-w-0 flex-col gap-4 p-1 sm:gap-6 sm:p-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 sm:text-xl">Financeiro</h1>
                        <p className="mt-0.5 text-xs text-zinc-400">
                            Recebido (caixa 1.1), títulos e resultado gerencial
                        </p>
                    </div>
                    <div className="-mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                        {(["today", "7d", "15d", "30d", "all", "custom"] as Period[]).map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPeriod(p)}
                                className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3 ${
                                    period === p
                                        ? "border-violet-600 bg-violet-600 text-white"
                                        : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                }`}
                            >
                                <Calendar className="h-3 w-3" />
                                {{
                                    today: "Hoje",
                                    "7d": "7d",
                                    "15d": "15d",
                                    "30d": "30d",
                                    all: "Todo período",
                                    custom: "Personalizado",
                                }[p]}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={refresh}
                            disabled={loading}
                            className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 sm:px-3"
                        >
                            <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                            <span className="hidden sm:inline">Atualizar</span>
                        </button>
                    </div>
                </div>

                <div className="-mx-1 max-w-full overflow-x-auto px-1 scrollbar-hide sm:mx-0 sm:px-0">
                    <div className="flex w-max min-w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50 sm:w-fit sm:min-w-0">
                        {tabs.map(({ id, label, short, icon: Icon, active }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setActiveTab(id)}
                                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold sm:px-4 ${
                                    activeTab === id ? `bg-white shadow dark:bg-zinc-800 ${active}` : "text-zinc-500"
                                }`}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                <span className="sm:hidden">{short}</span>
                                <span className="hidden sm:inline">{label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {period === "custom" && (
                    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:p-4">
                        <p className="text-xs font-medium text-zinc-500">De</p>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={(e) => setCustomFrom(e.target.value)}
                            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                        />
                        <p className="text-xs font-medium text-zinc-500 sm:ml-1">até</p>
                        <input
                            type="date"
                            value={customTo}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setCustomTo(e.target.value)}
                            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                        />
                        {customInvalid ? (
                            <p className="text-xs text-red-500">Informe duas datas válidas (início ≤ fim).</p>
                        ) : (
                            <p className="text-xs text-zinc-400">
                                {dateRange.days} dia{dateRange.days === 1 ? "" : "s"} · extrato em páginas de 50
                            </p>
                        )}
                    </div>
                )}

                {period === "all" && (
                    <p className="text-xs text-zinc-400">
                        Todo o período desde 2020-01-01 · extrato carrega 50 linhas por vez (“Carregar mais”).
                    </p>
                )}

                {activeTab === "dashboard" && (
                    <DashboardTab
                        stats={stats}
                        expenses={expenses}
                        loading={loading}
                        periodLabel={periodLabel}
                        onGoTab={setActiveTab}
                    />
                )}
                {activeTab === "extrato" && (
                    <ExtratoTab
                        companyId={companyId}
                        dateRange={dateRange}
                        periodLabel={periodLabel}
                        refreshKey={refreshKey}
                    />
                )}
                {activeTab === "receber" && <ReceberTab companyId={companyId} refreshKey={refreshKey} />}
                {activeTab === "pagar" && <PagarTab companyId={companyId} refreshKey={refreshKey} />}
                {activeTab === "caixa" && <CaixaTab companyId={companyId} refreshKey={refreshKey} />}
                {activeTab === "dre" && (
                    <DreTab
                        companyId={companyId}
                        dateRange={dateRange}
                        periodLabel={periodLabel}
                        stats={stats}
                        refreshKey={refreshKey}
                    />
                )}
            </div>
        </PlanFeatureGate>
    );
}
