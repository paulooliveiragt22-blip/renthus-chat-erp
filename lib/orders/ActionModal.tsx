"use client";

import React from "react";
import Modal from "./Modal";
import { prettyStatus } from "@/lib/orders/helpers";
import type { OrderStatus } from "@/lib/orders/types";
import { AlertTriangle } from "lucide-react";

export type ActionKind = "cancel" | "finalize";

const PAYMENT_OPTIONS = [
    { value: "pix",     label: "PIX" },
    { value: "card",    label: "Cartão" },
    { value: "cash",    label: "Dinheiro" },
    { value: "a_prazo", label: "A Prazo / Fiado" },
] as const;

const FINALIZED_STATUSES = new Set(["finalized", "entregue", "delivered"]);

export default function ActionModal({
    open,
    onClose,
    kind,
    note,
    setNote,
    saving,
    onConfirm,
    orderStatus,
    orderPaymentMethod,
    paymentMethod,
    setPaymentMethod,
}: {
    open: boolean;
    onClose: () => void;
    kind: ActionKind;
    note: string;
    setNote: (v: string) => void;
    saving: boolean;
    onConfirm: () => void;
    orderStatus?: string;
    orderPaymentMethod?: string;
    paymentMethod?: string;
    setPaymentMethod?: (v: string) => void;
}) {
    const showPayment = kind === "finalize" && !!setPaymentMethod;
    const statusNorm = String(orderStatus ?? "").trim().toLowerCase();
    const isFinalizedCancel = kind === "cancel" && FINALIZED_STATUSES.has(statusNorm);

    function actionTitle(k: ActionKind) {
        if (k === "cancel") {
            return isFinalizedCancel ? "Estornar pedido finalizado" : "Cancelar pedido";
        }
        return "Finalizar e registrar pagamento";
    }
    function actionStatus(k: ActionKind): OrderStatus {
        if (k === "cancel") return "canceled";
        return "finalized";
    }

    return (
        <Modal title={actionTitle(kind)} open={open} onClose={onClose} zClass="z-[10050]">
            <div className="grid gap-4">

                {kind === "cancel" && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800/50 dark:bg-amber-950/30">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="text-xs text-amber-900 dark:text-amber-100">
                            <p className="font-semibold">Estorno completo (dinheiro + estoque)</p>
                            <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
                                Os produtos deste pedido voltam ao estoque. Se já houve recebimento
                                ou liquidação financeira, os lançamentos serão estornados no extrato.
                            </p>
                            {isFinalizedCancel && (
                                <p className="mt-1 font-medium">
                                    Pedido já finalizado — use só se a venda não deve contar.
                                </p>
                            )}
                            <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">
                                Não é possível estornar se o caixa da venda já foi fechado.
                            </p>
                        </div>
                    </div>
                )}

                {showPayment && (
                    <div>
                        <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                            Forma de pagamento recebida:
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {PAYMENT_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setPaymentMethod?.(opt.value)}
                                    className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                                        paymentMethod === opt.value
                                            ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                            : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                    }`}
                                >
                                    {opt.label}
                                    {opt.value === orderPaymentMethod && paymentMethod !== opt.value && (
                                        <span className="ml-1 text-[11px] font-normal text-zinc-400"> (pedido)</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        {paymentMethod && (
                            <p className="mt-2 text-xs text-violet-600 dark:text-violet-400">
                                ✅ Será registrado em <strong>Financeiro</strong> como{" "}
                                <strong>{PAYMENT_OPTIONS.find((o) => o.value === paymentMethod)?.label}</strong>
                            </p>
                        )}
                    </div>
                )}

                <div>
                    <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        {kind === "cancel"
                            ? "Observação para registrar esta ação:"
                            : "Observação (opcional):"}
                    </p>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                            showPayment
                                ? "Ex: Pago na entrega, cupom fiscal entregue…"
                                : "Digite a observação..."
                        }
                        rows={3}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500"
                    />
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onConfirm}
                        disabled={saving || (showPayment && !paymentMethod)}
                        className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? "Salvando..." : showPayment ? "Confirmar & Registrar" : "Confirmar"}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                        Voltar
                    </button>
                </div>

                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Status final: <strong>{prettyStatus(actionStatus(kind))}</strong>
                    {showPayment && " · lançamento financeiro na finalização do pedido"}
                    {kind === "cancel" && " · itens removidos e estoque creditado"}
                </p>
            </div>
        </Modal>
    );
}
