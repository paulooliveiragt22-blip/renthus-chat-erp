"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, MessageSquare, RefreshCcw, Search } from "lucide-react";
import { getAllChannels, updateChannelIdentifier } from "@/lib/superadmin/actions";
import { toast } from "sonner";

// ─── Componente ───────────────────────────────────────────────────────────────

export default function CanaisPage() {
    const queryClient = useQueryClient();
    const [search, setSearch]           = useState("");
    const [editingId, setEditingId]     = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState("");

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["sa", "channels"],
        queryFn:  () => getAllChannels(),
        staleTime: 30_000,
    });

    const saveId = useMutation({
        mutationFn: ({ id, value }: { id: string; value: string }) =>
            updateChannelIdentifier(id, value),
        onSuccess: () => {
            toast.success("from_identifier atualizado");
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: ["sa", "channels"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const channels = (data ?? []).filter((ch: any) =>
        !search ||
        ch.from_identifier?.includes(search) ||
        (ch.companies as any)?.name?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-5">
            {/* ── Cabeçalho ────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Canais WhatsApp</h1>
                    <p className="text-xs text-zinc-500">{data?.length ?? 0} canal(is) cadastrado(s)</p>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 disabled:opacity-50"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            {/* ── Busca ────────────────────────────────────────────────────── */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por empresa ou phone_number_id…"
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
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
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    {channels.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
                            <MessageSquare className="h-7 w-7 opacity-30" />
                            <p className="text-sm">Nenhum canal encontrado</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Empresa</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">from_identifier (phone_number_id)</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                    <th className="w-8 px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {channels.map((ch: any) => (
                                    <tr key={ch.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                        <td className="px-4 py-3">
                                            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                                {(ch.companies as any)?.name ?? "—"}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {editingId === ch.id ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        autoFocus
                                                        value={editingValue}
                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                        className="rounded border border-primary bg-white px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20 dark:bg-zinc-800"
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") saveId.mutate({ id: ch.id, value: editingValue });
                                                            if (e.key === "Escape") setEditingId(null);
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => saveId.mutate({ id: ch.id, value: editingValue })}
                                                        disabled={saveId.isPending}
                                                        className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                                                    >
                                                        Salvar
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId(null)}
                                                        className="text-[11px] text-zinc-400 hover:text-zinc-600"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => { setEditingId(ch.id); setEditingValue(ch.from_identifier ?? ""); }}
                                                    className="group/code flex items-center gap-1.5"
                                                    title="Clique para editar"
                                                >
                                                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] group-hover/code:bg-primary/10 group-hover/code:text-primary dark:bg-zinc-800">
                                                        {ch.from_identifier || "(não configurado)"}
                                                    </code>
                                                </button>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${ch.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                                                {ch.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/superadmin/empresas/${(ch.companies as any)?.id}`}
                                                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
