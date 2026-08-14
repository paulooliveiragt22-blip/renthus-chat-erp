"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, RefreshCcw } from "lucide-react";
import { brl } from "../lib/format";
import type { CaixaMov, CaixaReg } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Props = {
    companyId: string | null;
    refreshKey: number;
};

export default function CaixaTab({ companyId, refreshKey }: Props) {
    const [list, setList] = useState<CaixaReg[]>([]);
    const [loading, setLoading] = useState(false);
    const [movs, setMovs] = useState<CaixaMov[]>([]);
    const [selected, setSelected] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const res = await fetch("/api/admin/financeiro/cash-registers", {
            credentials: "include",
            cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        setList((json.registers ?? []) as CaixaReg[]);
        setLoading(false);
    }, [companyId]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    async function loadMovs(id: string) {
        const res = await fetch(`/api/admin/financeiro/cash-movements?register_id=${encodeURIComponent(id)}`, {
            credentials: "include",
            cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        setMovs((json.movements ?? []) as CaixaMov[]);
        setSelected(id);
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Histórico de caixas</p>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                >
                    <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Atualizar
                </button>
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                {loading ? (
                    <div className="space-y-2 p-5">
                        {[...Array(4)].map((_, i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                ) : list.length === 0 ? (
                    <div className="py-12 text-center">
                        <Banknote className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                        <p className="mt-2 text-sm text-zinc-400">Nenhum caixa. Abra o primeiro no PDV.</p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                {[
                                    "Abertura",
                                    "Fechamento",
                                    "Operador",
                                    "Fundo",
                                    "Total esperado",
                                    "Contagem",
                                    "Diferença",
                                    "Status",
                                    "",
                                ].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-zinc-400">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                            {list.map((cx) => {
                                const expected = Number(cx.expected_balance ?? 0);
                                const counted = cx.closing_amount;
                                const diff =
                                    counted != null ? counted - expected : cx.difference;
                                return (
                                    <tr key={cx.id}>
                                        <td className="px-4 py-3 font-mono text-zinc-600">
                                            {new Date(cx.opened_at).toLocaleString("pt-BR", {
                                                day: "2-digit",
                                                month: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-zinc-500">
                                            {cx.closed_at
                                                ? new Date(cx.closed_at).toLocaleString("pt-BR", {
                                                      day: "2-digit",
                                                      month: "2-digit",
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                  })
                                                : "—"}
                                        </td>
                                        <td className="px-4 py-3">{cx.operator_name ?? "—"}</td>
                                        <td className="px-4 py-3 font-mono">{brl(cx.initial_amount ?? 0)}</td>
                                        <td className="px-4 py-3 font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                                            {brl(expected)}
                                        </td>
                                        <td className="px-4 py-3 font-mono">
                                            {counted != null ? brl(counted) : "—"}
                                        </td>
                                        <td
                                            className={`px-4 py-3 font-mono font-bold ${
                                                (diff ?? 0) < 0
                                                    ? "text-red-600"
                                                    : (diff ?? 0) > 0
                                                      ? "text-emerald-600"
                                                      : "text-zinc-400"
                                            }`}
                                        >
                                            {diff != null ? brl(diff) : "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                    cx.status === "open"
                                                        ? "bg-emerald-100 text-emerald-700"
                                                        : "bg-zinc-100 text-zinc-500"
                                                }`}
                                            >
                                                {cx.status === "open" ? "Aberto" : "Fechado"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => loadMovs(cx.id)}
                                                className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[10px] dark:border-zinc-700"
                                            >
                                                Movimentos
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {selected && movs.length > 0 && (
                <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                    <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                        <Banknote className="h-4 w-4 text-orange-500" />
                        <p className="text-sm font-bold">Movimentos do caixa</p>
                        <button
                            type="button"
                            onClick={() => {
                                setSelected(null);
                                setMovs([]);
                            }}
                            className="ml-auto text-xs text-zinc-400"
                        >
                            fechar
                        </button>
                    </div>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                {["Hora", "Tipo", "Valor", "Operador", "Motivo"].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-zinc-400">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {movs.map((m) => (
                                <tr key={m.id}>
                                    <td className="px-4 py-3 font-mono text-zinc-500">
                                        {new Date(m.occurred_at).toLocaleTimeString("pt-BR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </td>
                                    <td className="px-4 py-3">
                                        {m.type === "sangria" ? "Sangria" : "Suprimento"}
                                    </td>
                                    <td
                                        className={`px-4 py-3 font-mono font-bold ${m.type === "sangria" ? "text-red-600" : "text-emerald-600"}`}
                                    >
                                        {m.type === "sangria" ? "- " : "+ "}
                                        {brl(m.amount ?? 0)}
                                    </td>
                                    <td className="px-4 py-3">{m.operator_name ?? "—"}</td>
                                    <td className="px-4 py-3 text-zinc-500">{m.reason ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
