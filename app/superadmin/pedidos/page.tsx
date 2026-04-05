"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, Receipt, RefreshCcw } from "lucide-react";
import { getAllOrders } from "@/lib/superadmin/actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDate(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
    });
}

const PM: Record<string, string> = { pix: "PIX", cash: "Dinheiro", card: "Cartão" };

const STATUS: Record<string, { label: string; cls: string }> = {
    new:       { label: "Novo",       cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    confirmed: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    delivered: { label: "Entregue",   cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
    cancelled: { label: "Cancelado",  cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const LIMIT = 50;

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PedidosPage() {
    const [page, setPage] = useState(0);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["sa", "orders", page],
        queryFn:  () => getAllOrders(page, LIMIT),
        staleTime: 30_000,
    });

    const orders    = data?.orders ?? [];
    const total     = data?.total  ?? 0;
    const totalPages = Math.ceil(total / LIMIT);

    return (
        <div className="space-y-5">
            {/* ── Cabeçalho ────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Pedidos</h1>
                    <p className="text-xs text-zinc-500">{total} pedido(s) no total</p>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 disabled:opacity-50"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-20 text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            )}
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {(error as Error).message}
                </div>
            )}

            {/* ── Tabela ───────────────────────────────────────────────────── */}
            {!isLoading && !error && (
                <>
                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        {orders.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
                                <Receipt className="h-7 w-7 opacity-30" />
                                <p className="text-sm">Nenhum pedido</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">#</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Empresa</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total</th>
                                        <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sm:table-cell">Pgto</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                        <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:table-cell">Data</th>
                                        <th className="w-8 px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {orders.map((o: any) => {
                                        const st = STATUS[o.status] ?? { label: o.status, cls: "bg-zinc-100 text-zinc-500" };
                                        return (
                                            <tr key={o.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                                <td className="px-4 py-3">
                                                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-mono dark:bg-zinc-800">
                                                        #{o.id.replaceAll("-", "").slice(-6).toUpperCase()}
                                                    </code>
                                                </td>
                                                <td className="px-4 py-3 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                                    {(o.companies as any)?.name ?? "—"}
                                                </td>
                                                <td className="px-4 py-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                                    {formatCurrency(o.total_amount ?? 0)}
                                                </td>
                                                <td className="hidden px-4 py-3 text-xs text-zinc-500 sm:table-cell">
                                                    {PM[o.payment_method] ?? o.payment_method ?? "—"}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                                                        {st.label}
                                                    </span>
                                                </td>
                                                <td className="hidden px-4 py-3 text-xs text-zinc-400 lg:table-cell">
                                                    {formatDate(o.created_at)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Link
                                                        href={`/superadmin/empresas/${(o.companies as any)?.id}`}
                                                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700"
                                                    >
                                                        <ChevronRight className="h-4 w-4" />
                                                    </Link>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Paginação */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs text-zinc-500">
                                Página {page + 1} de {totalPages}
                            </span>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
