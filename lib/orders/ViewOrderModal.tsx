"use client";

import React from "react";
import Modal from "./Modal";
import { btnPurple, btnPurpleOutline, formatBRL, formatDT, prettyStatus, statusBadgeStyle } from "@/lib/orders/helpers";
import type { OrderFull } from "@/lib/orders/types";
import OrderPaymentInfo from "@/components/OrderPaymentInfo";

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
}) {
    const title = `Pedido ${order ? `• ${formatDT(order.created_at)} • ${prettyStatus(String(order.status))}` : ""}`;

    return (
        <Modal title={title} open={open} onClose={onClose}>
            {loading ? (
                <p>Carregando pedido...</p>
            ) : !order ? (
                <p>Nenhum pedido selecionado.</p>
            ) : (
                <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={onPrint} style={btnPurpleOutline(false)}>
                            Imprimir
                        </button>

                        <button onClick={() => onAction("cancel")} disabled={!canCancel} style={btnPurple(!canCancel)}>
                            Cancelar
                        </button>

                        <button onClick={() => onAction("deliver")} disabled={!canDeliver} style={btnPurple(!canDeliver)}>
                            Entregue
                        </button>

                        <button onClick={() => onAction("finalize")} disabled={!canFinalize} style={btnPurple(!canFinalize)}>
                            Finalizar
                        </button>

                        <button onClick={onEdit} disabled={!canEdit} style={btnPurpleOutline(!canEdit)}>
                            EDITAR
                        </button>
                    </div>

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Cliente</div>
                        <div style={{ fontWeight: 900 }}>{order.customers?.name ?? "-"}</div>
                        <div style={{ color: "#666" }}>{order.customers?.phone ?? ""}</div>
                        <div style={{ color: "#666" }}>{order.customers?.address ?? "-"}</div>

                        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={statusBadgeStyle(String(order.status))}>{prettyStatus(String(order.status))}</span>

                            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 8, background: "#fafafa", minWidth: 260 }}>
                                <div style={{ fontWeight: 900, marginBottom: 4 }}>Pagamento</div>
                                <OrderPaymentInfo payment_method={order.payment_method} paid={!!order.paid} change_for={order.change_for} total_amount={order.total_amount} />
                            </div>
                        </div>
                    </div>

                    {order.details ? (
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6, fontSize: 14 }}>OBSERVAÇÕES</div>
                            <div style={{ color: "#111", fontWeight: 900, fontSize: 14 }}>{order.details}</div>
                        </div>
                    ) : null}

                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Itens</div>

                        {order.items.length === 0 ? (
                            <p style={{ color: "#666" }}>Sem itens.</p>
                        ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ background: "#f7f7f7" }}>
                                        <th style={{ textAlign: "left", padding: 6, fontSize: 12 }}>Item</th>
                                        <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Qtd</th>
                                        <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Preço</th>
                                        <th style={{ textAlign: "right", padding: 6, fontSize: 12 }}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {order.items.map((it) => {
                                        const qIt = Number(it.quantity ?? 0);
                                        const price = Number(it.unit_price ?? 0);
                                        const total = Number(it.line_total ?? qIt * price);

                                        return (
                                            <tr key={it.id} style={{ borderTop: "1px solid #eee" }}>
                                                <td style={{ padding: 6 }}>{it.product_name ?? "Item"}</td>
                                                <td style={{ padding: 6, textAlign: "right" }}>{qIt}</td>
                                                <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(price)}</td>
                                                <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(total)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}

                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Taxa de entrega</span>
                                <b>R$ {formatBRL(order.delivery_fee ?? 0)}</b>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                <span>Total</span>
                                <b>R$ {formatBRL(order.total_amount ?? 0)}</b>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
