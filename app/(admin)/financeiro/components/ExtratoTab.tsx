"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, FileText, Wallet } from "lucide-react";
import { brl, isoDate, originLabel, PAY_META } from "../lib/format";
import type { DateRange, ExtratoLine } from "../lib/types";
import { Skeleton } from "./Skeleton";
import JournalEntryModal from "./JournalEntryModal";

type Props = {
    companyId: string | null;
    dateRange: DateRange;
    periodLabel: string;
    refreshKey: number;
};

export default function ExtratoTab({ companyId, dateRange, periodLabel, refreshKey }: Props) {
    const [lines, setLines] = useState<ExtratoLine[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [modal, setModal] = useState<ExtratoLine | null>(null);
    const [finalizeForm, setFinalizeForm] = useState({
        payment_method: "pix",
        due_date: isoDate(new Date()),
        notes: "",
    });
    const [finalizing, setFinalizing] = useState(false);
    const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);

    const fetchPage = useCallback(
        async (cursor: string | null, append: boolean) => {
            if (!companyId) return;
            if (append) setLoadingMore(true);
            else setLoading(true);
            const qs = new URLSearchParams({
                from: dateRange.from,
                to: dateRange.to,
                limit: "50",
            });
            if (cursor) qs.set("cursor", cursor);
            const res = await fetch(`/api/admin/financeiro/extrato?${qs}`, {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (!append) setLines([]);
                setNextCursor(null);
            } else {
                const page = (json.lines ?? []) as ExtratoLine[];
                setLines((prev) => (append ? [...prev, ...page] : page));
                setNextCursor(json.nextCursor ?? null);
            }
            setLoading(false);
            setLoadingMore(false);
        },
        [companyId, dateRange]
    );

    useEffect(() => {
        fetchPage(null, false);
    }, [fetchPage, refreshKey]);

    const income = lines.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
    const expenses = lines.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);

    async function handleFinalize() {
        if (!modal?.orderId || !companyId) return;
        setFinalizing(true);
        setFinalizeMsg(null);
        const res = await fetch("/api/admin/financeiro/finalize-order", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order_id: modal.orderId,
                payment_method: finalizeForm.payment_method,
                due_date: finalizeForm.due_date,
                notes: finalizeForm.notes,
                customer_id: modal.customerId,
                amount: modal.amount,
                idempotency_key: `order:${modal.orderId}:recognize`,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setFinalizing(false);
        if (!res.ok) {
            setFinalizeMsg("Erro: " + (json?.error ?? "falha"));
            return;
        }
        setModal(null);
        fetchPage(null, false);
    }

    function openLine(line: ExtratoLine) {
        setModal(line);
        setFinalizeForm({
            payment_method: line.payment_method !== "—" ? line.payment_method : "pix",
            due_date: isoDate(new Date()),
            notes: "",
        });
        setFinalizeMsg(null);
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                {[
                    { icon: ArrowUpCircle, label: "Entradas", value: brl(income), cls: "text-emerald-600" },
                    { icon: ArrowDownCircle, label: "Saídas", value: brl(expenses), cls: "text-red-500" },
                    {
                        icon: Wallet,
                        label: "Saldo",
                        value: brl(income - expenses),
                        cls: income - expenses >= 0 ? "text-violet-600" : "text-red-500",
                    },
                ].map(({ icon: Icon, label, value, cls }) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
                        <Icon className={`h-5 w-5 ${cls}`} />
                        <div>
                            <p className="text-xs text-zinc-400">{label}</p>
                            <p className={`text-lg font-bold ${cls}`}>{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:px-5">
                    <FileText className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Extrato — {periodLabel}</p>
                    <span className="ml-auto text-xs text-zinc-400">{lines.length} lançamentos</span>
                </div>

                {loading ? (
                    <div className="space-y-px p-4">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : lines.length === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-400">Nenhum lançamento no período.</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-xs">
                                <thead>
                                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                                        {["Data", "Descrição", "Cliente", "Origem", "Pagamento", "Valor", "Status"].map((h) => (
                                            <th key={h} className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-zinc-400">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {lines.map((line) => (
                                        <tr
                                            key={line.id}
                                            onClick={() => openLine(line)}
                                            className="cursor-pointer hover:bg-violet-50/50 dark:hover:bg-violet-900/10"
                                        >
                                            <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                                                {new Date(line.date).toLocaleDateString("pt-BR")}
                                                <span className="ml-1 text-zinc-300 dark:text-zinc-600">
                                                    {new Date(line.date).toLocaleTimeString("pt-BR", {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </span>
                                            </td>
                                            <td className="max-w-[220px] truncate px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">
                                                {line.description}
                                            </td>
                                            <td className="px-4 py-3 text-zinc-500">{line.customer}</td>
                                            <td className="px-4 py-3">
                                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                    {originLabel(line.channel)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-zinc-500">
                                                {PAY_META[line.payment_method]?.label ?? line.payment_method}
                                            </td>
                                            <td
                                                className={`px-4 py-3 text-right font-bold ${line.type === "expense" ? "text-red-500" : "text-emerald-600"}`}
                                            >
                                                {line.type === "expense" ? "− " : "+ "}
                                                {brl(line.amount)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                    {line.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {nextCursor && (
                            <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
                                <button
                                    type="button"
                                    disabled={loadingMore}
                                    onClick={() => fetchPage(nextCursor, true)}
                                    className="w-full rounded-lg border border-zinc-200 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                >
                                    {loadingMore ? "Carregando…" : "Carregar mais"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <JournalEntryModal
                line={modal}
                onClose={() => setModal(null)}
                onReversed={() => fetchPage(null, false)}
                finalizeForm={finalizeForm}
                setFinalizeForm={setFinalizeForm}
                onFinalize={handleFinalize}
                finalizing={finalizing}
                finalizeMsg={finalizeMsg}
            />
        </div>
    );
}
