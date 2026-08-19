"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { isPrazoMethod } from "@/src/financeiro/domain/paymentMethod";
import {
    isReversibleJournalLine,
    journalLineKey,
    type JournalDetail,
} from "@/src/financeiro/application/reverseJournal";
import { brl, isoDate, originLabel, PAY_META } from "../lib/format";
import type { ExtratoLine } from "../lib/types";

function canReverseJournal(line: ExtratoLine, detail: JournalDetail | null): boolean {
    if (line.journalStatus !== "posted" || line.journalSourceType === "reversal") return false;
    if (!detail) return false;
    return detail.lines.some(isReversibleJournalLine);
}

function reverseErrorLabel(code: string): string {
    if (code === "settlement_conflict") return "Caixa da venda já foi fechado — não é possível estornar.";
    if (code === "journal_already_reversed") return "Este lançamento já foi estornado por completo.";
    if (code === "cannot_reverse_reversal") return "Não é possível estornar um estorno.";
    if (code === "journal_line_exceeds_remaining") return "Valor maior que o restante disponível.";
    if (code === "journal_lines_required") return "Selecione pelo menos uma linha para estornar.";
    return code || "Falha ao estornar";
}

type LineSelection = { checked: boolean; amount: string };

type Props = {
    line: ExtratoLine | null;
    onClose: () => void;
    onReversed: () => void;
    finalizeForm: {
        payment_method: string;
        due_date: string;
        notes: string;
    };
    setFinalizeForm: React.Dispatch<
        React.SetStateAction<{ payment_method: string; due_date: string; notes: string }>
    >;
    onFinalize: () => void;
    finalizing: boolean;
    finalizeMsg: string | null;
};

export default function JournalEntryModal({
    line,
    onClose,
    onReversed,
    finalizeForm,
    setFinalizeForm,
    onFinalize,
    finalizing,
    finalizeMsg,
}: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [detail, setDetail] = useState<JournalDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [selection, setSelection] = useState<Record<string, LineSelection>>({});
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [reversing, setReversing] = useState(false);

    const journalId = line?.journalId ?? null;

    const loadDetail = useCallback(async () => {
        if (!journalId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/financeiro/journals/${journalId}`, {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setDetail(null);
                setError(String(json?.error ?? "Falha ao carregar lançamento"));
                return;
            }
            const j = json.journal as JournalDetail;
            setDetail(j);
            const sel: Record<string, LineSelection> = {};
            for (const ln of j.lines.filter(isReversibleJournalLine)) {
                const key = journalLineKey(ln);
                sel[key] = { checked: false, amount: "" };
            }
            setSelection(sel);
            setNote("");
        } finally {
            setLoading(false);
        }
    }, [journalId]);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (line) {
            if (!el.open) el.showModal();
            void loadDetail();
        } else if (el.open) {
            el.close();
            setConfirmOpen(false);
            setDetail(null);
        }
    }, [line, loadDetail]);

    const reversibleLines = detail?.lines.filter(isReversibleJournalLine) ?? [];

    function toggleLine(line: JournalDetailLine, checked: boolean) {
        const key = journalLineKey(line);
        setSelection((prev) => ({
            ...prev,
            [key]: {
                checked,
                amount: checked
                    ? String(line.remaining.toFixed(2)).replace(".", ",")
                    : prev[key]?.amount ?? "",
            },
        }));
    }

    function markAllLines() {
        const next: Record<string, LineSelection> = { ...selection };
        for (const ln of reversibleLines) {
            const key = journalLineKey(ln);
            next[key] = {
                checked: true,
                amount: String(ln.remaining.toFixed(2)).replace(".", ","),
            };
        }
        setSelection(next);
    }

    function buildPartialLines(): Array<{ code: string; dir: "debit" | "credit"; amt: number }> {
        const out: Array<{ code: string; dir: "debit" | "credit"; amt: number }> = [];
        for (const ln of reversibleLines) {
            const key = journalLineKey(ln);
            const sel = selection[key];
            if (!sel?.checked) continue;
            const raw = sel.amount.trim().replace(",", ".");
            const amt = Number.parseFloat(raw);
            if (!Number.isFinite(amt) || amt <= 0) continue;
            if (amt > ln.remaining) throw new Error("journal_line_exceeds_remaining");
            out.push({ code: ln.code, dir: ln.direction, amt: Math.round(amt * 100) / 100 });
        }
        return out;
    }

    function selectedTotal(): number {
        let t = 0;
        for (const ln of reversibleLines) {
            const key = journalLineKey(ln);
            const sel = selection[key];
            if (!sel?.checked) continue;
            const raw = sel.amount.trim().replace(",", ".");
            const amt = Number.parseFloat(raw);
            if (Number.isFinite(amt) && amt > 0) t += amt;
        }
        return Math.round(t * 100) / 100;
    }

    function selectedLabels(): string[] {
        const labels: string[] = [];
        for (const ln of reversibleLines) {
            const key = journalLineKey(ln);
            if (selection[key]?.checked) labels.push(ln.label);
        }
        return labels;
    }

    function openConfirm() {
        setError(null);
        try {
            const lines = buildPartialLines();
            if (lines.length === 0) {
                setError("Selecione pelo menos uma linha para estornar.");
                return;
            }
            setConfirmOpen(true);
        } catch (e) {
            setError(reverseErrorLabel(e instanceof Error ? e.message : ""));
        }
    }

    async function executeReverse() {
        if (!journalId) return;
        setReversing(true);
        setError(null);
        try {
            const lines = buildPartialLines();
            const res = await fetch(`/api/admin/financeiro/journals/${journalId}/reverse`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reason: note.trim() || null,
                    lines,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(reverseErrorLabel(String(json?.error ?? "")));
                setConfirmOpen(false);
                return;
            }
            setConfirmOpen(false);
            onClose();
            onReversed();
        } finally {
            setReversing(false);
        }
    }

    if (!line) return null;

    const showFinalize =
        line.orderId && !["finalized", "delivered"].includes(line.orderStatus ?? "");
    const canReverse = canReverseJournal(line, detail);

    return (
        <>
            <dialog
                ref={dialogRef}
                className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900"
                onCancel={(e) => {
                    e.preventDefault();
                    onClose();
                }}
            >
                <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {line.description}
                        </p>
                        <p className="text-xs text-zinc-400">
                            {new Date(line.date).toLocaleString("pt-BR")}
                            {detail?.entrySeq != null ? ` · Lançamento #${detail.entrySeq}` : ""}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-4 px-5 py-4">
                    {loading && <p className="text-sm text-zinc-500">Carregando lançamento…</p>}
                    {error && !confirmOpen && (
                        <p className="flex items-start gap-1 text-xs font-semibold text-red-600">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    {detail && (
                        <>
                            <div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 px-4 py-3 text-xs dark:bg-zinc-800/80 sm:grid-cols-4">
                                <div>
                                    <p className="text-zinc-400">Cliente</p>
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                                        {detail.order?.customerName ?? line.customer}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Origem</p>
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                                        {originLabel(line.channel)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Pagamento</p>
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                                        {PAY_META[line.payment_method]?.label ?? line.payment_method}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-zinc-400">Valor (extrato)</p>
                                    <p
                                        className={`text-lg font-bold ${line.type === "income" ? "text-emerald-600" : "text-red-500"}`}
                                    >
                                        {line.type === "expense" ? "− " : "+ "}
                                        {brl(line.amount)}
                                    </p>
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                    Partidas do lançamento
                                </p>
                                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <table className="w-full text-xs">
                                        <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Conta</th>
                                                <th className="px-3 py-2 text-left">Tipo</th>
                                                <th className="px-3 py-2 text-right">Valor</th>
                                                <th className="px-3 py-2 text-right">Resta</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                            {detail.lines.map((ln) => (
                                                <tr key={journalLineKey(ln)}>
                                                    <td className="px-3 py-2">
                                                        <span className="font-medium">{ln.label}</span>
                                                        <span className="text-zinc-400"> ({ln.code})</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-zinc-500">
                                                        {ln.direction === "debit" ? "Débito" : "Crédito"}
                                                    </td>
                                                    <td className="px-3 py-2 text-right">{brl(ln.amount)}</td>
                                                    <td className="px-3 py-2 text-right text-zinc-500">
                                                        {brl(ln.remaining)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {detail.order && (
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                        Pedido · {detail.order.status}
                                    </p>
                                    <div className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                                        <p className="mb-2 text-zinc-500">
                                            Total {brl(detail.order.totalAmount)}
                                            {detail.order.deliveryFee > 0 &&
                                                ` · Entrega ${brl(detail.order.deliveryFee)}`}
                                        </p>
                                        <ul className="space-y-1">
                                            {detail.order.items.map((it) => (
                                                <li key={it.id} className="flex justify-between gap-2">
                                                    <span>
                                                        {it.quantity}× {it.productName}
                                                    </span>
                                                    <span className="text-zinc-500">{brl(it.lineTotal)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        {detail.order.fees.length > 0 && (
                                            <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                                                {detail.order.fees.map((f, i) => (
                                                    <li key={i} className="flex justify-between gap-2 text-zinc-500">
                                                        <span>{f.label}</span>
                                                        <span>{brl(f.amount)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}

                            {detail.priorReversals.length > 0 && (
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                        Estornos anteriores
                                    </p>
                                    <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                                        {detail.priorReversals.map((r) => (
                                            <li key={r.id} className="flex justify-between gap-2">
                                                <span>
                                                    {new Date(r.postedAt).toLocaleString("pt-BR")}
                                                    {r.reason ? ` — ${r.reason}` : ""}
                                                </span>
                                                <span className="text-red-500">− {brl(r.amount)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {line.orderId && (
                                <Link
                                    href={`/pedidos?open=${line.orderId}`}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Abrir pedido em nova tela
                                </Link>
                            )}

                            {canReverse && (
                                <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                                    <div className="mb-3 flex items-center justify-between">
                                        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                            Estornar linhas do lançamento
                                        </p>
                                        <button
                                            type="button"
                                            onClick={markAllLines}
                                            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                        >
                                            Marcar todas
                                        </button>
                                    </div>
                                    <p className="mb-3 text-[11px] text-zinc-500">
                                        Não devolve produtos ao estoque. Para cancelar o pedido completo, use Pedidos.
                                    </p>
                                    <div className="space-y-2">
                                        {reversibleLines.map((ln) => {
                                            const key = journalLineKey(ln);
                                            const sel = selection[key];
                                            return (
                                                <label
                                                    key={key}
                                                    className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={sel?.checked ?? false}
                                                        onChange={(e) => toggleLine(ln, e.target.checked)}
                                                        className="rounded border-zinc-300"
                                                    />
                                                    <span className="min-w-0 flex-1 text-xs">
                                                        <span className="font-medium">{ln.label}</span>
                                                        <span className="text-zinc-400">
                                                            {" "}
                                                            (resta {brl(ln.remaining)})
                                                        </span>
                                                    </span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        disabled={!sel?.checked}
                                                        value={sel?.amount ?? ""}
                                                        onChange={(e) =>
                                                            setSelection((prev) => ({
                                                                ...prev,
                                                                [key]: {
                                                                    checked: prev[key]?.checked ?? false,
                                                                    amount: e.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className="w-24 rounded border border-zinc-200 px-2 py-1 text-right text-xs disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
                                                    />
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <textarea
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="Observação (opcional)"
                                        rows={2}
                                        className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                    />
                                    <div className="mt-3 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={openConfirm}
                                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                        >
                                            Estornar seleção…
                                        </button>
                                    </div>
                                </div>
                            )}

                            {showFinalize && (
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
                                        onClick={onFinalize}
                                        disabled={finalizing}
                                        className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                    >
                                        {finalizing ? "Finalizando…" : "Finalizar e liquidar"}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </dialog>

            {confirmOpen && (
                <dialog
                    open
                    className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Confirmar estorno</h3>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                        Estornar <strong>{brl(selectedTotal())}</strong> em:{" "}
                        {selectedLabels().join(", ")}.
                    </p>
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                        Isso altera o extrato e o caixa. Não devolve produtos ao estoque.
                    </p>
                    {error && (
                        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
                    )}
                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            disabled={reversing}
                            onClick={() => setConfirmOpen(false)}
                            className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium dark:border-zinc-700"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            disabled={reversing}
                            onClick={() => void executeReverse()}
                            className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {reversing ? "Estornando…" : "Confirmar estorno"}
                        </button>
                    </div>
                </dialog>
            )}
        </>
    );
}
