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
    Truck,
    User,
    XCircle,
    CheckCircle2,
    PackageCheck,
} from "lucide-react";

// ── paletas de status ─────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
    new:       "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    finalized: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    canceled:  "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const PAYMENT_COLORS: Record<string, string> = {
    pix:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    card: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    cash: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
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
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${PAYMENT_COLORS[pm] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                    {label}
                </span>
                {paid && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> pago
                    </span>
                )}
            </div>
            {pm === "cash" && (
                <div className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <p>Cliente paga com: <span className="font-semibold text-zinc-900 dark:text-zinc-100">R$ {formatBRL(pays)}</span></p>
                    <p>Troco a levar: <span className="font-semibold text-zinc-900 dark:text-zinc-100">R$ {formatBRL(troco)}</span></p>
                </div>
            )}
            {pm === "card" && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Levar maquininha</p>
            )}
        </div>
    );
}

// ── extrai info estruturada do item — padrão UI:
//   Nível 1: PRODUCTS.NAME (bold, uppercase)
//   Nível 2: descricao volume [SIGLA C/FatorUN]  +  qty sigla  +  total
function getItemInfo(it: any) {
    const emb = (it as any)._emb ?? null;
    if (emb) {
        const prodName  = String(emb.product_name ?? "").toUpperCase().trim();
        const sigla     = String(emb.sigla_comercial ?? "UN").toUpperCase();
        const descricao = (emb.descricao ?? "").trim();
        const volStr    = (emb.volume_formatado ?? "").trim();
        const fator     = Number(emb.fator_conversao) || null;
        const unitLabel = sigla === "CX" ? "cx" : sigla === "UN" ? "un" : sigla.toLowerCase();

        // Linha de embalagem: descricao + volume + (SIGLA C/FatorUN) quando não-UN
        let detail = [descricao, volStr].filter(Boolean).join(" ");
        if (sigla !== "UN") {
            const fatorPart = fator && fator > 1 ? ` C/${fator}UN` : "";
            detail = [detail, `${sigla}${fatorPart}`].filter(Boolean).join(" ");
        }

        return {
            productName: prodName || String(it.product_name ?? "PRODUTO").split(" • ")[0].toUpperCase().trim(),
            detail: detail || prodName || "Item",
            unitLabel,
        };
    }
    // Fallback: parse "ProdName • detail" armazenado em order_items.product_name
    const raw      = String(it.product_name ?? "PRODUTO");
    const bIdx     = raw.indexOf(" • ");
    const prodName = bIdx >= 0 ? raw.slice(0, bIdx).toUpperCase().trim() : raw.toUpperCase().trim();
    const detail   = bIdx >= 0 ? raw.slice(bIdx + 3).trim() : raw.trim();
    return { productName: prodName, detail, unitLabel: it.unit_type === "case" ? "cx" : "un" };
}

// ── componente principal ──────────────────────────────────────────────────────
export default function ViewOrderModal({
    open,
    onClose,
    loading,
    order,
    onPrint,
    onReprint,
    reprintLoading,
    reprintMsg,
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
    onReprint?: () => void;
    reprintLoading?: boolean;
    reprintMsg?: { ok: boolean; text: string } | null;
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
                        <div key={i} className="h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                    ))}
                </div>
            ) : !order ? (
                <p className="py-8 text-center text-sm text-zinc-400">Nenhum pedido selecionado.</p>
            ) : (
                <div className="flex flex-col gap-4 pt-1">

                    {/* ── TOOLBAR ── */}
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 p-3">

                        {/* Secundários */}
                        <button
                            onClick={onPrint}
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            Imprimir
                        </button>

                        {onReprint && (
                            <button
                                onClick={onReprint}
                                disabled={reprintLoading}
                                className="flex items-center gap-1.5 rounded-lg border border-orange-300 dark:border-orange-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400 shadow-sm hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
                            >
                                <Printer className="h-3.5 w-3.5" />
                                {reprintLoading ? "Enviando..." : "Reimprimir"}
                            </button>
                        )}

                        {canEdit && (
                            <button
                                onClick={onEdit}
                                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                            </button>
                        )}

                        {/* Ações semânticas */}
                        {canDeliver && (
                            <button
                                onClick={() => onAction("deliver")}
                                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
                            >
                                <PackageCheck className="h-3.5 w-3.5" />
                                Marcar entregue
                            </button>
                        )}

                        {canFinalize && (
                            <button
                                onClick={() => onAction("finalize")}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
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
                                    className="flex items-center gap-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
                                >
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    {sendingOutForDelivery ? "Enviando..." : "Saiu pra entrega"}
                                </button>

                                <button
                                    onClick={onDeliveredMessage}
                                    disabled={sendingDeliveredMessage}
                                    className="flex items-center gap-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
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
                                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                Cancelar pedido
                            </button>
                        )}
                    </div>

                    {/* ── FEEDBACK REIMPRIMIR ── */}
                    {reprintMsg && (
                        <div className={`rounded-lg px-3 py-2 text-xs font-medium border ${
                            reprintMsg.ok
                                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                        }`}>
                            {reprintMsg.text}
                        </div>
                    )}

                    {/* ── STATUS + CLIENTE ── */}
                    <div className="relative rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4">

                        {/* Status badge flutuante */}
                        <span className={`absolute right-4 top-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${STATUS_COLORS[st] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                            {prettyStatus(st)}
                        </span>

                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Cliente</p>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <User className="h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{order.customers?.name ?? "-"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm text-zinc-700 dark:text-zinc-300">{order.customers?.phone ?? "-"}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                                <span className="text-sm text-zinc-700 dark:text-zinc-300">{order.customers?.address || "Não informado"}</span>
                            </div>
                        </div>

                        {/* Pagamento */}
                        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Pagamento</p>
                            <PaymentBlock
                                payment_method={order.payment_method}
                                paid={!!order.paid}
                                change_for={order.change_for}
                                total_amount={order.total_amount}
                            />
                        </div>

                        {/* Entregador */}
                        {(order as any).drivers?.name && (
                            <div className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Entregador</p>
                                <div className="flex items-center gap-2">
                                    <Truck className="h-4 w-4 shrink-0 text-zinc-400" />
                                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                        {(order as any).drivers.name}
                                    </span>
                                    {(order as any).drivers.vehicle && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                            · {(order as any).drivers.vehicle}
                                            {(order as any).drivers.plate ? ` (${(order as any).drivers.plate})` : ""}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── OBSERVAÇÕES ── */}
                    {order.details ? (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-4">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-500 dark:text-amber-400">Observações</p>
                            <p className="text-sm font-bold text-amber-900 dark:text-amber-300">{order.details}</p>
                        </div>
                    ) : null}

                    {/* ── ITENS ── */}
                    <div className="overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                        <div className="bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Itens do pedido</p>
                        </div>

                        {order.items.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-zinc-400">Sem itens.</p>
                        ) : (() => {
                            const groups = new Map<string, { it: any; info: ReturnType<typeof getItemInfo> }[]>();
                            for (const it of order.items) {
                                const info = getItemInfo(it);
                                if (!groups.has(info.productName)) groups.set(info.productName, []);
                                groups.get(info.productName)!.push({ it, info });
                            }
                            return (
                                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {Array.from(groups.entries()).map(([productName, entries]) => (
                                        <div key={productName} className="py-2">
                                            {/* Nível 1 — PRODUCTS.NAME */}
                                            <p className="px-4 pb-1 text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                                                {productName}
                                            </p>
                                            {/* Nível 2 — embalagens */}
                                            {entries.map(({ it, info }) => {
                                                const q     = Number((it as any).quantity ?? (it as any).qty ?? 0);
                                                const price = Number((it as any).unit_price ?? 0);
                                                const total = Number((it as any).line_total ?? q * price);
                                                return (
                                                    <div key={(it as any).id} className="flex items-center gap-2 px-4 pl-8 py-1">
                                                        {/* descricao volume [SIGLA C/FatorUN] */}
                                                        <span className="flex-1 text-sm text-zinc-500 dark:text-zinc-400">{info.detail}</span>
                                                        {/* qty */}
                                                        <span className="shrink-0 inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                                                            {q} {info.unitLabel}
                                                        </span>
                                                        {/* total */}
                                                        <span className="w-20 shrink-0 text-right text-sm font-semibold text-zinc-900 dark:text-emerald-400">
                                                            R$ {formatBRL(total)}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>

                    {/* ── TOTAL FOOTER ── */}
                    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 px-5 py-4">
                        {Number(order.delivery_fee ?? 0) > 0 && (
                            <div className="mb-2 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                                <span>Taxa de entrega</span>
                                <span className="font-medium">R$ {formatBRL(order.delivery_fee ?? 0)}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <span className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Total geral</span>
                            <span className="text-2xl font-bold text-zinc-900 dark:text-emerald-400">
                                R$ {formatBRL(order.total_amount ?? 0)}
                            </span>
                        </div>
                    </div>

                </div>
            )}
        </Modal>
    );
}
