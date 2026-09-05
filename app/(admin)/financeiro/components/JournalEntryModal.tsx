"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { isPrazoMethod } from "@/src/financeiro/domain/paymentMethod";
import {
    isReversibleJournalLine,
    journalLineKey,
    type JournalDetail,
} from "@/src/financeiro/application/reverseJournal";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { brl, originLabel, PAY_META } from "../lib/format";
import type { ExtratoLine } from "../lib/types";

type ConfirmMode = "partial" | "full" | null;

function canReverseJournal(line: ExtratoLine, detail: JournalDetail | null): boolean {
    if (line.journalStatus !== "posted" || line.journalSourceType === "reversal") return false;
    if (!detail) return false;
    if (line.orderId || detail.orderId) return true;
    return detail.lines.some(isReversibleJournalLine);
}

function reverseErrorLabel(code: string): string {
    if (code === "settlement_conflict") return "Caixa da venda já foi fechado — não é possível estornar.";
    if (code === "journal_already_reversed") return "Este lançamento já foi estornado por completo.";
    if (code === "cannot_reverse_reversal") return "Não é possível estornar um estorno.";
    if (code === "partial_requires_items") return "Selecione itens, taxa de entrega ou taxas de serviço.";
    if (code === "prazo_partial_blocked") return "Estorno parcial não disponível para venda a prazo.";
    if (code === "order_item_invalid") return "Quantidade de item inválida.";
    if (code === "403" || /insufficient|capability|forbidden/i.test(code)) {
        return "Sem permissão para estornar (financeiro.write).";
    }
    return code || "Falha ao estornar";
}

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
    const [detail, setDetail] = useState<JournalDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [itemSelection, setItemSelection] = useState<Record<string, boolean>>({});
    const [includeDelivery, setIncludeDelivery] = useState(false);
    const [includeServiceFees, setIncludeServiceFees] = useState(false);
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
    const [reversing, setReversing] = useState(false);

    const journalId = line?.journalId ?? null;
    const orderId = line?.orderId ?? detail?.orderId ?? null;
    const useOrderReverse = Boolean(orderId);

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
            const items: Record<string, boolean> = {};
            for (const it of j.order?.items ?? []) {
                items[it.id] = false;
            }
            setItemSelection(items);
            setIncludeDelivery(false);
            setIncludeServiceFees(false);
            setNote("");
        } finally {
            setLoading(false);
        }
    }, [journalId]);

    useEffect(() => {
        if (line) {
            void loadDetail();
        } else {
            setConfirmMode(null);
            setDetail(null);
        }
    }, [line, loadDetail]);

    function markAllItems() {
        if (!detail?.order) return;
        const next: Record<string, boolean> = {};
        for (const it of detail.order.items) {
            next[it.id] = true;
        }
        setItemSelection(next);
    }

    function buildPartialItems(): Array<{ order_item_id: string; qty: number }> {
        if (!detail?.order) return [];
        return detail.order.items
            .filter((it) => itemSelection[it.id])
            .map((it) => ({
                order_item_id: it.id,
                qty: it.quantity,
            }));
    }

    function partialSelectionSummary(): string {
        const parts: string[] = [];
        for (const it of detail?.order?.items ?? []) {
            if (itemSelection[it.id]) {
                parts.push(`${it.quantity}× ${it.productName}`);
            }
        }
        if (includeDelivery && detail?.order && detail.order.deliveryFee > 0) {
            parts.push("Taxa de entrega");
        }
        if (includeServiceFees && detail?.order?.fees.some((f) => f.systemKey !== "delivery")) {
            parts.push("Taxas de serviço");
        }
        return parts.join(", ");
    }

    function openConfirm(mode: ConfirmMode) {
        setError(null);
        if (mode === "partial") {
            const items = buildPartialItems();
            const hasFees =
                (includeDelivery && (detail?.order?.deliveryFee ?? 0) > 0) ||
                (includeServiceFees &&
                    (detail?.order?.fees.some((f) => f.systemKey !== "delivery") ?? false));
            if (items.length === 0 && !hasFees) {
                setError("Selecione itens ou taxas para estornar.");
                return;
            }
        }
        setConfirmMode(mode);
    }

    async function executeOrderReverse(mode: "full" | "partial") {
        if (!orderId) {
            setError("Pedido não encontrado neste lançamento.");
            setConfirmMode(null);
            return;
        }
        setReversing(true);
        setError(null);
        try {
            const idempotencyKey = `order:${orderId}:reverse:${mode}:${Date.now()}`;
            const res = await fetch("/api/admin/financeiro/reverse-order", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    order_id: orderId,
                    mode,
                    items: mode === "partial" ? buildPartialItems() : undefined,
                    include_delivery_fee: mode === "partial" ? includeDelivery : false,
                    include_service_fees: mode === "partial" ? includeServiceFees : false,
                    reason: note.trim() || null,
                    idempotency_key: idempotencyKey,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                // Mantém o painel aberto para o erro ficar visível
                setError(reverseErrorLabel(String(json?.error ?? res.status)));
                return;
            }
            setConfirmMode(null);
            onClose();
            onReversed();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Falha ao estornar");
        } finally {
            setReversing(false);
        }
    }

    const showFinalize =
        line?.orderId && !["finalized", "delivered"].includes(line.orderStatus ?? "");
    const canReverse = line ? canReverseJournal(line, detail) : false;
    const hasServiceFees = detail?.order?.fees.some((f) => f.systemKey !== "delivery") ?? false;

    return (
        <>
            <Dialog
                open={!!line}
                onOpenChange={(next) => {
                    if (!next) {
                        setConfirmMode(null);
                        onClose();
                    }
                }}
            >
                <DialogContent
                    hideClose
                    className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl"
                    aria-describedby={undefined}
                >
                    {line ? (
                        <>
                            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                                <DialogHeader className="min-w-0 flex-1 space-y-0">
                                    <DialogTitle className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                        {line.description}
                                    </DialogTitle>
                                    <p className="text-xs text-zinc-400">
                                        {new Date(line.date).toLocaleString("pt-BR")}
                                        {detail?.entrySeq != null ? ` · Lançamento #${detail.entrySeq}` : ""}
                                    </p>
                                </DialogHeader>
                                <DialogClose asChild>
                                    <button
                                        type="button"
                                        className="text-zinc-400 hover:text-zinc-600"
                                        aria-label="Fechar"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </DialogClose>
                            </div>

                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                                {loading && <p className="text-sm text-zinc-500">Carregando lançamento…</p>}
                                {error && !confirmMode && (
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
                                                                <li
                                                                    key={i}
                                                                    className="flex justify-between gap-2 text-zinc-500"
                                                                >
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

                                        {canReverse && useOrderReverse && detail.order && (
                                            <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                                        Estornar pedido (financeiro + estoque)
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={markAllItems}
                                                        className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                                    >
                                                        Marcar todos itens
                                                    </button>
                                                </div>
                                                <p className="mb-3 text-[11px] text-zinc-500">
                                                    Estorna o lançamento vigente e reemite o pedido com o que sobrou
                                                    (parcial).
                                                </p>
                                                <div className="space-y-2">
                                                    {detail.order.items.map((it) => (
                                                        <label
                                                            key={it.id}
                                                            className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={itemSelection[it.id] ?? false}
                                                                onChange={(e) =>
                                                                    setItemSelection((prev) => ({
                                                                        ...prev,
                                                                        [it.id]: e.target.checked,
                                                                    }))
                                                                }
                                                                className="rounded border-zinc-300"
                                                            />
                                                            <span className="min-w-0 flex-1 text-xs">
                                                                <span className="font-medium">
                                                                    {it.quantity}× {it.productName}
                                                                </span>
                                                                <span className="text-zinc-400">
                                                                    {" "}
                                                                    ({brl(it.lineTotal)})
                                                                </span>
                                                            </span>
                                                        </label>
                                                    ))}
                                                    {detail.order.deliveryFee > 0 && (
                                                        <label className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={includeDelivery}
                                                                onChange={(e) => setIncludeDelivery(e.target.checked)}
                                                                className="rounded border-zinc-300"
                                                            />
                                                            <span className="text-xs font-medium">
                                                                Taxa de entrega ({brl(detail.order.deliveryFee)})
                                                            </span>
                                                        </label>
                                                    )}
                                                    {hasServiceFees && (
                                                        <label className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={includeServiceFees}
                                                                onChange={(e) =>
                                                                    setIncludeServiceFees(e.target.checked)
                                                                }
                                                                className="rounded border-zinc-300"
                                                            />
                                                            <span className="text-xs font-medium">
                                                                Taxas de serviço
                                                            </span>
                                                        </label>
                                                    )}
                                                </div>
                                                <textarea
                                                    value={note}
                                                    onChange={(e) => setNote(e.target.value)}
                                                    placeholder="Observação (opcional)"
                                                    rows={2}
                                                    className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                />
                                                {error && (
                                                    <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-red-600">
                                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                        {error}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {showFinalize && (
                                            <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-800 dark:bg-violet-900/20">
                                                <p className="text-xs font-bold text-violet-700 dark:text-violet-300">
                                                    Finalizar pedido
                                                </p>
                                                <Select
                                                    value={finalizeForm.payment_method}
                                                    onValueChange={(v) =>
                                                        setFinalizeForm((f) => ({ ...f, payment_method: v }))
                                                    }
                                                >
                                                    <SelectTrigger className="w-full rounded-lg border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectGroup>
                                                            <SelectLabel>À vista</SelectLabel>
                                                            <SelectItem value="pix">PIX</SelectItem>
                                                            <SelectItem value="cash">Dinheiro</SelectItem>
                                                            <SelectItem value="card">Cartão</SelectItem>
                                                            <SelectItem value="debit">Débito</SelectItem>
                                                        </SelectGroup>
                                                        <SelectGroup>
                                                            <SelectLabel>A prazo</SelectLabel>
                                                            <SelectItem value="credit_installment">
                                                                Crédito parcelado
                                                            </SelectItem>
                                                            <SelectItem value="boleto">Boleto</SelectItem>
                                                            <SelectItem value="promissoria">Promissória</SelectItem>
                                                            <SelectItem value="cheque">Cheque</SelectItem>
                                                        </SelectGroup>
                                                    </SelectContent>
                                                </Select>
                                                {isPrazoMethod(finalizeForm.payment_method) && (
                                                    <input
                                                        type="date"
                                                        value={finalizeForm.due_date}
                                                        onChange={(e) =>
                                                            setFinalizeForm((f) => ({
                                                                ...f,
                                                                due_date: e.target.value,
                                                            }))
                                                        }
                                                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                                    />
                                                )}
                                                {finalizeMsg && (
                                                    <p className="text-xs font-semibold text-red-600">
                                                        {finalizeMsg}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {((canReverse && useOrderReverse && detail?.order) || showFinalize) && (
                                <DialogFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800 sm:justify-end">
                                    {canReverse && useOrderReverse && detail?.order && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    openConfirm("partial");
                                                }}
                                                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                            >
                                                Estornar seleção…
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    openConfirm("full");
                                                }}
                                                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                                            >
                                                Estornar pedido completo…
                                            </button>
                                        </>
                                    )}
                                    {showFinalize && (
                                        <button
                                            type="button"
                                            onClick={onFinalize}
                                            disabled={finalizing}
                                            className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                        >
                                            {finalizing ? "Finalizando…" : "Finalizar e liquidar"}
                                        </button>
                                    )}
                                </DialogFooter>
                            )}
                        </>
                    ) : null}
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!confirmMode}
                onOpenChange={(next) => {
                    if (!next) {
                        setConfirmMode(null);
                        setError(null);
                    }
                }}
            >
                <DialogContent
                    hideClose
                    overlayClassName="z-[60]"
                    className="z-[60] flex max-h-[90vh] max-w-sm flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl"
                    aria-describedby={undefined}
                >
                    <DialogHeader className="shrink-0 space-y-0 px-5 pt-5">
                        <DialogTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {confirmMode === "full"
                                ? "Cancelar pedido completo"
                                : "Confirmar estorno parcial"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
                        {confirmMode === "full" ? (
                            <p className="text-xs text-zinc-600 dark:text-zinc-300">
                                Estorna todo o lançamento, devolve todos os produtos ao estoque e cancela o pedido. Não
                                haverá reemissão financeira.
                            </p>
                        ) : (
                            <p className="text-xs text-zinc-600 dark:text-zinc-300">
                                Estornar: <strong>{partialSelectionSummary() || "seleção"}</strong>. O lançamento atual
                                será estornado e um novo será criado com o que sobrou.
                            </p>
                        )}
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                            Altera extrato, caixa e estoque. Esta ação não pode ser desfeita pelo extrato.
                        </p>
                        {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
                    </div>
                    <DialogFooter className="shrink-0 flex-row gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:justify-stretch">
                        <button
                            type="button"
                            disabled={reversing}
                            onClick={() => {
                                setConfirmMode(null);
                                setError(null);
                            }}
                            className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium dark:border-zinc-700"
                        >
                            Voltar
                        </button>
                        <button
                            type="button"
                            disabled={reversing || !confirmMode}
                            onClick={() => {
                                if (confirmMode) void executeOrderReverse(confirmMode);
                            }}
                            className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {reversing ? "Processando…" : "Confirmar"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
