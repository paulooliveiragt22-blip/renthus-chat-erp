"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Building2, Loader2, MessageSquare, Receipt, TrendingUp } from "lucide-react";
import { getDashboardStats } from "@/lib/superadmin/actions";

function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SuperAdminDashboard() {
    const { data, isLoading } = useQuery({
        queryKey: ["sa", "dashboard"],
        queryFn:  () => getDashboardStats(),
        staleTime: 60_000,
    });

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
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
                <p className="text-xs text-zinc-400">Visão geral da plataforma</p>
            </div>

            {/* Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
