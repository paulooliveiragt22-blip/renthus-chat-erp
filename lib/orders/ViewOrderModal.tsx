"use client";

import React from "react";
import Modal from "./Modal";
import {
    formatBRL,
    formatDT,
    prettyStatus,
    calcTroco,
} from "@/lib/orders/helpers";
import type { OrderFull, PaymentMethod } from "@/lib/orders/types";
import {
    MapPin,
    MessageCircle,
    Pencil,
    Phone,
    Printer,
    User,
    XCircle,
    CheckCircle2,
    PackageCheck,
} from "lucide-react";

// ── paletas de status ─────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
    new:       "bg-blue-100 text-blue-700",
    delivered: "bg-emerald-100 text-emerald-700",
    finalized: "bg-violet-100 text-violet-700",
    canceled:  "bg-zinc-100 text-zinc-500",
};

const PAYMENT_COLORS: Record<string, string> = {
    pix:  "bg-green-100 text-green-700",
    card: "bg-purple-100 text-purple-700",
    cash: "bg-amber-100 text-amber-700",
};

function paymentLabel(pm: string) {
    return pm === "pix" ? "PIX" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : pm;
}

// ── subcomponente de pagamento ────────────────────────────────────────────────
function PaymentBlock({
    payment_method,
    paid,
    change_for,
    total_amount,
}: {
    payment_method: PaymentMethod | string;
    paid: boolean;
    change_for: number | null;
    total_amount: number | null | undefined;
}) {
    const pm    = String(payment_method);
    const label = paymentLabel(pm);
    const total = Number(total_amount ?? 0);
    const pays  = Number(change_for ?? 0);
    const troco = calcTroco(total, pays);

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${PAYMENT_COLORS[pm] ?? "bg-zinc-100 text-zinc-500"}`}>
                    {label}
                </span>
                {paid && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> pago
                    </span>
                )}
            </div>
            {pm === "cash" && (
                <div className="mt-1 space-y-0.5 text-xs text-zinc-600">
                    <p>Cliente paga com: <span className="font-semibold text-zinc-900">R$ {formatBRL(pays)}</span></p>
                    <p>Troco a levar: <span className="font-semibold text-zinc-900">R$ {formatBRL(troco)}</span></p>
                </div>
            )}
            {pm === "card" && (
                <p className="mt-1 text-xs text-zinc-500">Levar maquininha</p>
            )}
        </div>
    );
}

// ── helper de qty ─────────────────────────────────────────────────────────────
function qtyDisplay(it: any): string {
    const q  = Number(it.quantity ?? it.qty ?? 0);
    const ut = String(it.unit_type ?? "").toLowerCase();
    if (ut === "unit") return `${q} ${q > 1 ? "unidades" : "unidade"}`;
    if (ut === "case") {
        return `cx × ${q}`;
    }
    return `${q}`;
}

// ── componente principal ──────────────────────────────────────────────────────
export default function ViewOrderModal({
    open,
    onClose,
    loading,
    order,
    onPrint,
    onEdit,
    onAction,
    canCancel,
    canDeliver,
    canFinalize,
    canEdit,
    onOutForDelivery,
    onDeliveredMessage,
    sendingOutForDelivery,
    sendingDeliveredMessage,
}: {
    open: boolean;
    onClose: () => void;
    loading: boolean;
    order: OrderFull | null;
    onPrint: () => void;
    onEdit: () => void;
    onAction: (kind: "cancel" | "deliver" | "finalize") => void;
    canCancel: boolean;
    canDeliver: boolean;
    canFinalize: boolean;
    canEdit: boolean;
    onOutForDelivery: () => void;
    onDeliveredMessage: () => void;
    sendingOutForDelivery: boolean;
    sendingDeliveredMessage: boolean;
}) {
    const st     = order ? String(order.status) : "";
    const ordNum = order ? String(order.id).slice(-6).toUpperCase() : "";

    return (
        <Modal
            title={order ? `Pedido #${ordNum} • ${formatDT(order.created_at)}` : "Pedido"}
            open={open}
            onClose={onClose}
        >
            {loading ? (
                <div className="flex flex-col gap-3 py-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-4 w-full animate-pulse rounded bg-zinc-100" />
                    ))}
                </div>
            ) : !order ? (
                <p className="py-8 text-center text-sm text-zinc-400">Nenhum pedido selecionado.</p>
            ) : (
                <div className="flex flex-col gap-4 pt-1">

                    {/* ── TOOLBAR ── */}
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 p-3">

                        {/* Secundários */}
                        <button
                            onClick={onPrint}
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 transition-colors"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            Imprimir
                        </button>

                        {canEdit && (
                            <button
                                onClick={onEdit}
                                className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 transition-colors"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                            </button>
                        )}

                        {/* Ações semânticas */}
                        {canDeliver && (
                            <button
                                onClick={() => onAction("deliver")}
                                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 transition-colors"
                            >
                                <PackageCheck className="h-3.5 w-3.5" />
                                Marcar entregue
                            </button>
                        )}

                        {canFinalize && (
                            <button
                                onClick={() => onAction("finalize")}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Finalizar
                            </button>
                        )}

                        {/* WhatsApp */}
                        {order.customers?.phone && (
                            <>
                                <button
                                    onClick={onOutForDelivery}
                                    disabled={sendingOutForDelivery}
                                    className="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors"
                                >
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    {sendingOutForDelivery ? "Enviando..." : "Saiu pra entrega"}
                                </button>

                                <button
                                    onClick={onDeliveredMessage}
                                    disabled={sendingDeliveredMessage}
                                    className="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors"
                                >
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    {sendingDeliveredMessage ? "Enviando..." : "Agradecimento"}
                                </button>
                            </>
                        )}

                        {/* Cancelar — discreto, no final */}
                        {canCancel && (
                            <button
                                onClick={() => onAction("cancel")}
                                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                Cancelar pedido
                            </button>
                        )}
                    </div>

                    {/* ── STATUS + CLIENTE ── */}
                    <div className="relative rounded-xl border border-zinc-100 bg-zinc-50 p-4">

                        {/* Status badge flutuante */}
                        <span className={`absolute right-4 top-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${STATUS_COLORS[st] ?? "bg-zinc-100 text-zinc-500"}`}>
                            {prettyStatus(st)}
                        </span>

                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Cliente</p>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <User className="h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm font-bold text-zinc-900">{order.customers?.name ?? "-"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm text-zinc-700">{order.customers?.phone ?? "-"}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm font-bold text-zinc-900">{order.customers?.address || "Não informado"}</span>
                            </div>
                        </div>

                        {/* Pagamento */}
                        <div className="mt-4 border-t border-zinc-200 pt-3">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Pagamento</p>
                            <PaymentBlock
                                payment_method={order.payment_method}
                                paid={!!order.paid}
                                change_for={order.change_for}
                                total_amount={order.total_amount}
                            />
                        </div>
                    </div>

                    {/* ── OBSERVAÇÕES ── */}
                    {order.details ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-500">Observações</p>
                            <p className="text-sm font-bold text-amber-900">{order.details}</p>
                        </div>
                    ) : null}

                    {/* ── ITENS ── */}
                    <div className="overflow-hidden rounded-xl border border-zinc-100">
                        <div className="bg-zinc-50 px-4 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Itens do pedido</p>
                        </div>

                        {order.items.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-zinc-400">Sem itens.</p>
                        ) : (
                            <div className="divide-y divide-zinc-100">
                                {order.items.map((it) => {
                                    const q     = Number(it.quantity ?? it.qty ?? 0);
                                    const price = Number(it.unit_price ?? 0);
                                    const total = Number(it.line_total ?? q * price);

                                    return (
                                        <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                                            {/* Qty pill */}
                                            <span className="inline-flex min-w-[3rem] items-center justify-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700">
                                                {qtyDisplay(it)}
                                            </span>

                                            {/* Nome */}
                                            <span className="flex-1 text-sm font-medium text-zinc-900">
                                                {it.product_name ?? "Item"}
                                            </span>

                                            {/* Unitário */}
                                            <span className="text-xs text-zinc-400">
                                                R$ {formatBRL(price)} un.
                                            </span>

                                            {/* Subtotal */}
                                            <span className="w-24 text-right text-sm font-bold text-zinc-900">
                                                R$ {formatBRL(total)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* ── TOTAL FOOTER ── */}
                    <div className="rounded-xl bg-purple-50 px-5 py-4">
                        {Number(order.delivery_fee ?? 0) > 0 && (
                            <div className="mb-2 flex items-center justify-between text-sm text-zinc-600">
                                <span>Taxa de entrega</span>
                                <span className="font-medium">R$ {formatBRL(order.delivery_fee ?? 0)}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <span className="text-base font-semibold text-purple-800">Total geral</span>
                            <span className="text-2xl font-bold text-purple-900">
                                R$ {formatBRL(order.total_amount ?? 0)}
                            </span>
                        </div>
                    </div>

                </div>
            )}
        </Modal>
    );
}
