// app/(admin)/financeiro/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { BadgeDollarSign, ShoppingCart, TrendingUp, Wallet } from "lucide-react";

type DaySummary = { date: string; total: number; orders: number };

function brl(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FinanceiroPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();
    const [days,     setDays]     = useState<DaySummary[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [total30,  setTotal30]  = useState(0);
    const [orders30, setOrders30] = useState(0);

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const since = new Date();
        since.setDate(since.getDate() - 29);
        const { data } = await supabase
            .from("orders")
            .select("created_at, total_amount")
            .eq("company_id", companyId)
            .neq("status", "canceled")
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: true });

        const map: Record<string, { total: number; orders: number }> = {};
        (data ?? []).forEach((o: any) => {
            const d = new Date(o.created_at).toLocaleDateString("pt-BR");
            if (!map[d]) map[d] = { total: 0, orders: 0 };
            map[d].total  += Number(o.total_amount ?? 0);
            map[d].orders += 1;
        });

        const list = Object.entries(map).map(([date, v]) => ({ date, ...v })).reverse();
        setDays(list);
        const sum   = list.reduce((a, b) => a + b.total, 0);
        const count = list.reduce((a, b) => a + b.orders, 0);
        setTotal30(sum);
        setOrders30(count);
        setLoading(false);
    }, [companyId, supabase]);

    useEffect(() => { load(); }, [load]);

    const ticket = orders30 > 0 ? total30 / orders30 : 0;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Financeiro</h1>
                <p className="mt-0.5 text-xs text-zinc-400">Resumo dos últimos 30 dias</p>
            </div>

            {/* summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                    { icon: BadgeDollarSign, label: "Faturamento (30d)", value: brl(total30), color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/30" },
                    { icon: ShoppingCart,    label: "Pedidos (30d)",      value: String(orders30), color: "text-orange-500", bg: "bg-orange-100 dark:bg-orange-900/30" },
                    { icon: TrendingUp,      label: "Ticket Médio",       value: brl(ticket), color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
                ].map(({ icon: Icon, label, value, color, bg }) => (
                    <div key={label} className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm dark:bg-zinc-900">
                        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${bg}`}>
                            <Icon className={`h-5 w-5 ${color}`} />
                        </span>
                        <div>
                            <p className="text-xs text-zinc-400">{label}</p>
                            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{loading ? "…" : value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* day-by-day table */}
            <div className="rounded-xl bg-white shadow-sm dark:bg-zinc-900 overflow-hidden">
                <div className="border-b border-zinc-100 dark:border-zinc-800 px-5 py-3 flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Por dia</p>
                </div>
                {loading ? (
                    <div className="py-16 text-center text-sm text-zinc-400">Carregando…</div>
                ) : days.length === 0 ? (
                    <div className="py-16 text-center text-sm text-zinc-400">Nenhum pedido nos últimos 30 dias.</div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {days.map((d) => (
                            <div key={d.date} className="flex items-center justify-between px-5 py-3">
                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{d.date}</p>
                                <div className="flex items-center gap-6">
                                    <p className="text-xs text-zinc-400">{d.orders} pedidos</p>
                                    <p className="text-sm font-bold text-violet-600">{brl(d.total)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
