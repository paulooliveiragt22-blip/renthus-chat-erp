"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, AlertTriangle, FileText, RotateCcw, Wallet, X } from "lucide-react";
import { isPrazoMethod } from "@/src/financeiro/domain/paymentMethod";
import {
    isReversibleJournalLine,
    type JournalDetail,
    type JournalDetailLine,
} from "@/src/financeiro/application/reverseJournal";
import { brl, isoDate, originLabel, PAY_META } from "../lib/format";
import type { DateRange, ExtratoLine } from "../lib/types";
import { Skeleton } from "./Skeleton";

type Props = {
    companyId: string | null;
    dateRange: DateRange;
    periodLabel: string;
    refreshKey: number;
};

function canReverseJournal(line: ExtratoLine): boolean {
    return line.journalStatus === "posted" && line.journalSourceType !== "reversal";
}

function reverseErrorLabel(code: string): string {
    if (code === "settlement_conflict") {
        return "Caixa da venda já foi fechado — não é possível estornar.";
    }
    if (code === "journal_already_reversed") {
        return "Este lançamento já foi estornado por completo.";
    }
    if (code === "cannot_reverse_reversal") {
        return "Não é possível estornar um estorno.";
    }
    if (code === "journal_line_exceeds_remaining") {
        return "Valor maior que o restante disponível na linha.";
    }
    if (code === "reason_required") {
        return "Informe o motivo do estorno.";
    }
    return code || "Falha ao estornar";
}

export default function ExtratoTab({ companyId, dateRange, periodLabel, refreshKey }: Props) {
    const [lines, setLines] = useState<ExtratoLine[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [modal, setModal] = useState<ExtratoLine | null>(null);
    const [journalDetail, setJournalDetail] = useState<JournalDetail | null>(null);
    const [journalLoading, setJournalLoading] = useState(false);
    const [finalizeForm, setFinalizeForm] = useState({
        payment_method: "pix",
        due_date: isoDate(new Date()),
        notes: "",
    });
    const [finalizing, setFinalizing] = useState(false);
    const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
    const [reversalReason, setReversalReason] = useState("");
    const [partialAmounts, setPartialAmounts] = useState<Record<string, string>>({});
    const [reversing, setReversing] = useState(false);
    const [reversalMsg, setReversalMsg] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);

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

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (modal) {
            if (!el.open) el.showModal();
        } else if (el.open) {
            el.close();
        }
    }, [modal]);

    useEffect(() => {
        if (!modal?.journalId || !canReverseJournal(modal)) {
            setJournalDetail(null);
            return;
        }
        let cancelled = false;
        setJournalLoading(true);
        setReversalReason("");
        setPartialAmounts({});
        setReversalMsg(null);
        void (async () => {
            try {
                const res = await fetch(`/api/admin/financeiro/journals/${modal.journalId}`, {
                    credentials: "include",
                    cache: "no-store",
                });
                const json = await res.json().catch(() => ({}));
                if (!cancelled && res.ok) {
                    setJournalDetail(json.journal as JournalDetail);
                } else if (!cancelled) {
                    setJournalDetail(null);
                }
            } catch {
                if (!cancelled) setJournalDetail(null);
            }
            if (!cancelled) setJournalLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [modal?.journalId, modal?.id]);

    const income = lines.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
    const expenses = lines.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);

    const reversibleLines =
        journalDetail?.lines.filter(isReversibleJournalLine) ?? [];

    function lineKey(line: JournalDetailLine): string {
        return `${line.code}:${line.direction}`;
    }

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

    async function handleReverse(mode: "full" | "partial") {
        if (!modal?.journalId) return;
        const reason = reversalReason.trim();
        if (!reason) {
            setReversalMsg(reverseErrorLabel("reason_required"));
            return;
        }

        const partialLines: Array<{ code: string; dir: "debit" | "credit"; amt: number }> = [];
        if (mode === "partial") {
            for (const line of reversibleLines) {
                const key = lineKey(line);
                const raw = partialAmounts[key]?.trim().replace(",", ".");
                const amt = raw ? Number.parseFloat(raw) : 0;
                if (amt > 0) {
                    partialLines.push({
                        code: line.code,
                        dir: line.direction,
                        amt,
                    });
                }
            }
            if (partialLines.length === 0) {
                setReversalMsg("Selecione linhas e valores para estorno parcial.");
                return;
            }
        }

        setReversing(true);
        setReversalMsg(null);
        const res = await fetch(`/api/admin/financeiro/journals/${modal.journalId}/reverse`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode,
                reason,
                lines: mode === "partial" ? partialLines : undefined,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setReversing(false);
        if (!res.ok) {
            setReversalMsg(reverseErrorLabel(String(json?.error ?? "")));
            return;
        }
        setModal(null);
        fetchPage(null, false);
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
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
                <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
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
                            <table className="w-full text-xs">
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
                                            onClick={() => {
                                                setModal(line);
                                                setFinalizeForm({
                                                    payment_method:
                                                        line.payment_method !== "—" ? line.payment_method : "pix",
                                                    due_date: isoDate(new Date()),
                                                    notes: "",
                                                });
                                                setFinalizeMsg(null);
                                            }}
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

            <dialog
                ref={dialogRef}
                className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900"
                onCancel={(e) => {
                    e.preventDefault();
                    setModal(null);
                }}
            >
                {modal && (
                    <>
                        <div className="flex items-center gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                    {modal.description}
                                </p>
                                <p className="text-xs text-zinc-400">{new Date(modal.date).toLocaleString("pt-BR")}</p>
                            </div>
                            <button type="button" onClick={() => setModal(null)} className="text-zinc-400">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-3 px-6 py-4">
                            <div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 px-4 py-3 text-xs dark:bg-zinc-800">
                                <div>
                                    <p className="text-zinc-400">Cliente</p>
                                    <p className="font-semibold text-zinc-700 dark:text-zinc-200">{modal.customer}</p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Origem</p>
                                    <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                                        {originLabel(modal.channel)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Pagamento</p>
                                    <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                                        {PAY_META[modal.payment_method]?.label ?? modal.payment_method}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Valor</p>
                                    <p
                                        className={`text-lg font-bold ${modal.type === "income" ? "text-emerald-600" : "text-red-500"}`}
                                    >
                                        {brl(modal.amount)}
                                    </p>
                                </div>
                            </div>

                            {modal.orderId && (
                                <Link
                                    href={`/pedidos?id=${modal.orderId}`}
                                    className="block rounded-xl border border-zinc-200 px-4 py-2 text-center text-xs font-semibold text-violet-700 hover:bg-zinc-50 dark:border-zinc-700"
                                >
                                    Abrir pedido
                                </Link>
                            )}
                            {modal.saleId && !modal.orderId && (
                                <p className="rounded-xl bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:bg-zinc-800">
                                    Venda {modal.saleId.slice(0, 8)}
                                </p>
                            )}

                            {canReverseJournal(modal) && (
                                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-800 dark:bg-amber-950/30">
                                    <div className="flex items-center gap-2">
                                        <RotateCcw className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                                        <p className="text-xs font-bold text-amber-900 dark:text-amber-100">
                                            Estornar lançamento
                                        </p>
                                    </div>
                                    <p className="text-[11px] text-amber-800 dark:text-amber-200/90">
                                        Estorna o valor no extrato. Não altera estoque automaticamente — use
                                        cancelamento do pedido se precisa devolver produtos.
                                    </p>

                                    {journalLoading ? (
                                        <p className="text-xs text-zinc-500">Carregando linhas…</p>
                                    ) : journalDetail ? (
                                        <div className="space-y-2">
                                            {reversibleLines.length > 0 ? (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
                                                        Estorno parcial (opcional)
                                                    </p>
                                                    {reversibleLines.map((line) => {
                                                        const key = lineKey(line);
                                                        return (
                                                            <div
                                                                key={key}
                                                                className="flex items-center gap-2 rounded-lg border border-amber-100 bg-white/80 px-2 py-1.5 dark:border-amber-900 dark:bg-zinc-900/50"
                                                            >
                                                                <div className="min-w-0 flex-1 text-[11px]">
                                                                    <span className="font-semibold">{line.code}</span>
                                                                    <span className="text-zinc-500"> · {line.name}</span>
                                                                    <span className="text-zinc-400">
                                                                        {" "}
                                                                        (resta {brl(line.remaining)})
                                                                    </span>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    placeholder="0,00"
                                                                    value={partialAmounts[key] ?? ""}
                                                                    onChange={(e) =>
                                                                        setPartialAmounts((prev) => ({
                                                                            ...prev,
                                                                            [key]: e.target.value,
                                                                        }))
                                                                    }
                                                                    className="w-20 rounded border border-zinc-200 px-2 py-1 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-zinc-500">
                                                    Nada restante para estorno parcial.
                                                </p>
                                            )}
                                        </div>
                                    ) : null}

                                    <textarea
                                        value={reversalReason}
                                        onChange={(e) => setReversalReason(e.target.value)}
                                        placeholder="Motivo do estorno (obrigatório)"
                                        rows={2}
                                        className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-800 dark:bg-zinc-900"
                                    />

                                    {reversalMsg && (
                                        <p className="flex items-start gap-1 text-xs font-semibold text-red-600">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            {reversalMsg}
                                        </p>
                                    )}

                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            disabled={reversing}
                                            onClick={() => void handleReverse("full")}
                                            className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                        >
                                            {reversing ? "Estornando…" : "Estornar lançamento completo"}
                                        </button>
                                        {reversibleLines.length > 0 && (
                                            <button
                                                type="button"
                                                disabled={reversing}
                                                onClick={() => void handleReverse("partial")}
                                                className="w-full rounded-xl border border-amber-300 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
                                            >
                                                Estornar parcial (linhas preenchidas)
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {modal.orderId && !["finalized", "delivered"].includes(modal.orderStatus ?? "") && (
                                <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-800 dark:bg-violet-900/20">
                                    <p className="text-xs font-bold text-violet-700 dark:text-violet-300">
                                        Finalizar pedido
                                    </p>
                                    <select
                                        value={finalizeForm.payment_method}
                                        onChange={(e) =>
                                            setFinalizeForm((f) => ({ ...f, payment_method: e.target.value }))
                                        }
                                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                    >
                                        <optgroup label="À vista">
                                            <option value="pix">PIX</option>
                                            <option value="cash">Dinheiro</option>
                                            <option value="card">Cartão</option>
                                            <option value="debit">Débito</option>
                                        </optgroup>
                                        <optgroup label="A prazo">
                                            <option value="credit_installment">Crédito parcelado</option>
                                            <option value="boleto">Boleto</option>
                                            <option value="promissoria">Promissória</option>
                                            <option value="cheque">Cheque</option>
                                        </optgroup>
                                    </select>
                                    {isPrazoMethod(finalizeForm.payment_method) && (
                                        <input
                                            type="date"
                                            value={finalizeForm.due_date}
                                            onChange={(e) =>
                                                setFinalizeForm((f) => ({ ...f, due_date: e.target.value }))
                                            }
                                            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                        />
                                    )}
                                    {finalizeMsg && (
                                        <p className="text-xs font-semibold text-red-600">{finalizeMsg}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleFinalize}
                                        disabled={finalizing}
                                        className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                    >
                                        {finalizing ? "Finalizando…" : "Finalizar e liquidar"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </dialog>
        </div>
    );
}
