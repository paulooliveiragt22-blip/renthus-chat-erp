"use client";

import React from "react";
import Modal from "./Modal";
import {
    btnPurple,
    btnPurpleOutline,
    formatBRL,
    formatDT,
    prettyStatus,
    statusBadgeStyle,
    ORANGE,
} from "@/lib/orders/helpers";
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

    function qtyDisplay(it: any) {
        const qIt = Number(it.quantity ?? it.qty ?? 0);
        const ut = String(it.unit_type ?? "").toLowerCase();

        if (ut === "unit") {
            return `${qIt} ${qIt > 1 ? "unidades" : "unidade"}`;
        } else if (ut === "case") {
            // case_qty pode estar em it.case_qty (mapeamos) ou em it.product_variants (array ou object)
            const pv = it.product_variants;
            let cq = it.case_qty ?? null;
            if (cq == null && pv != null) {
                if (Array.isArray(pv)) cq = pv[0]?.case_qty ?? null;
                else cq = pv.case_qty ?? null;
            }

            const cqText = cq ? `caixa com: ${cq}` : `caixa`;
            return `${cqText} • ${qIt} ${qIt > 1 ? "caixas" : "caixa"}`;
        } else {
            return `${qIt}`;
        }
    }


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

                    {/* Cliente + Pagamento (lado esquerdo), Status (lado direito) */}
                    <div
                        style={{
                            border: "1px solid #eee",
                            borderRadius: 12,
                            padding: 10,
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                        }}
                    >
                        {/* Coluna esquerda: cliente + pagamento */}
                        <div style={{ minWidth: 0, flex: 1, maxWidth: "72ch" }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Cliente</div>
                            <div style={{ fontWeight: 900 }}>{order.customers?.name ?? "-"}</div>
                            <div style={{ color: "#666" }}>{order.customers?.phone ?? ""}</div>
                            <div style={{ color: "#666" }}>{order.customers?.address ?? "-"}</div>

                            {/* Pagamento: alinhado verticalmente à esquerda com os dados do cliente */}
                            <div
                                style={{
                                    marginTop: 12,
                                    border: "1px solid #eee",
                                    borderRadius: 12,
                                    padding: 12,
                                    background: "#fafafa",
                                    maxWidth: 320,
                                }}
                            >
                                <div style={{ fontWeight: 900, marginBottom: 6 }}>Pagamento</div>
                                <OrderPaymentInfo
                                    payment_method={order.payment_method}
                                    paid={!!order.paid}
                                    change_for={order.change_for}
                                    total_amount={order.total_amount}
                                />
                            </div>
                        </div>

                        {/* Coluna direita: status badge */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ minWidth: 120 }}>
                                <span style={statusBadgeStyle(String(order.status))}>{prettyStatus(String(order.status))}</span>
                            </div>
                        </div>
                    </div>

                    {order.details ? (
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6, fontSize: 14 }}>OBSERVAÇÕES</div>
                            <div style={{ color: ["delivered", "canceled", "finalized"].includes(String(order.status)) ? ORANGE : "#111", fontWeight: 900, fontSize: 14 }}>
                                {order.details}
                            </div>
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
                                        const qIt = Number(it.quantity ?? it.qty ?? 0);
                                        const price = Number(it.unit_price ?? 0);
                                        const total = Number(it.line_total ?? qIt * price);

                                        return (
                                            <tr key={it.id} style={{ borderTop: "1px solid #eee" }}>
                                                <td style={{ padding: 6 }}>{it.product_name ?? "Item"}</td>
                                                <td style={{ padding: 6, textAlign: "right" }}>{qtyDisplay(it)}</td>
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
