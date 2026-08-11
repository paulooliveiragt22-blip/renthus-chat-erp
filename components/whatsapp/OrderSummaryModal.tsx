"use client";

/**
 * Detalhe read-only de um pedido antigo do cliente — deep link a partir da
 * seção "Últimos pedidos" da sidebar de perfil no WhatsApp Inbox. Gestão
 * completa (editar/cancelar/finalizar/imprimir) continua só na tela Pedidos;
 * aqui é só consulta rápida sem sair da conversa.
 */

import React, { useEffect, useState } from "react";
import Modal from "@/lib/orders/Modal";
import { formatBRL, formatDT, prettyStatus, calcTroco } from "@/lib/orders/helpers";
import type { OrderFull } from "@/lib/orders/types";

const STATUS_COLORS: Record<string, string> = {
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    delivered: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    finalized: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    canceled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function paymentLabel(pm: string) {
    return pm === "pix" ? "PIX" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : pm;
}

export default function OrderSummaryModal({
    open,
    onClose,
    orderId,
}: {
    open: boolean;
    onClose: () => void;
    orderId: string | null;
}) {
    const [order, setOrder] = useState<OrderFull | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !orderId) { setOrder(null); return; }
        let cancelled = false;
        setLoading(true);
        setErr(null);
        (async () => {
            try {
                const res = await fetch(`/api/admin/orders/${orderId}`, { cache: "no-store", credentials: "include" });
                const json = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok) { setErr(json?.error ?? "Falha ao carregar pedido"); setOrder(null); return; }
                setOrder(json.order as OrderFull);
            } catch {
                if (!cancelled) setErr("Falha ao carregar pedido");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, orderId]);

    const st = order ? String(order.status) : "";
    const ordNum = order ? String(order.id).slice(-6).toUpperCase() : "";

    return (
        <Modal title={order ? `Pedido #${ordNum} • ${formatDT(order.created_at)}` : "Pedido"} open={open} onClose={onClose} zClass="z-[10000]">
            {loading ? (
                <div className="flex flex-col gap-3 py-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                    ))}
                </div>
            ) : err ? (
                <p className="py-8 text-center text-sm text-rose-500">{err}</p>
            ) : !order ? (
                <p className="py-8 text-center text-sm text-zinc-400">Nenhum pedido selecionado.</p>
            ) : (
                <div className="flex flex-col gap-4 pt-1">
                    <div className="relative rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4">
                        <span className={`absolute right-4 top-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${STATUS_COLORS[st] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                            {prettyStatus(st)}
                        </span>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Pagamento</p>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                            {paymentLabel(String(order.payment_method))}
                            {order.paid && <span className="ml-2 font-semibold text-emerald-600 dark:text-emerald-400">pago</span>}
                        </p>
                        {order.payment_method === "cash" && Number(order.change_for ?? 0) > 0 && (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                Cliente paga com R$ {formatBRL(order.change_for)} · Troco R$ {formatBRL(calcTroco(Number(order.total_amount ?? 0), Number(order.change_for ?? 0)))}
                            </p>
                        )}
                        {order.customers?.address && (
                            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Endereço: </span>
                                {order.customers.address}
                            </p>
                        )}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                        <div className="bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Itens do pedido</p>
                        </div>
                        {order.items.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-zinc-400">Sem itens.</p>
                        ) : (
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {order.items.map((it) => {
                                    const q = Number((it as any).quantity ?? (it as any).qty ?? 0);
                                    const price = Number(it.unit_price ?? 0);
                                    const total = Number(it.line_total ?? q * price);
                                    return (
                                        <div key={it.id} className="flex items-center gap-2 px-4 py-2">
                                            <span className="flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">{it.product_name}</span>
                                            <span className="shrink-0 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                                                {q}x
                                            </span>
                                            <span className="w-20 shrink-0 text-right text-sm font-semibold text-zinc-900 dark:text-emerald-400">
                                                R$ {formatBRL(total)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 px-5 py-4">
                        {Number(order.delivery_fee ?? 0) > 0 && (
                            <div className="mb-2 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                                <span>Taxa de entrega</span>
                                <span className="font-medium">R$ {formatBRL(order.delivery_fee)}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <span className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Total geral</span>
                            <span className="text-xl font-bold text-zinc-900 dark:text-emerald-400">R$ {formatBRL(order.total_amount)}</span>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
