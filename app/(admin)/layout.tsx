"use client";

import React, { Suspense, useMemo, useState } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import { AdminOrdersProvider } from "@/components/AdminOrdersContext";
import { createClient } from "@/lib/supabase/client";

type PaymentMethod = "pix" | "card" | "cash";
type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

type OrderRow = {
    id: string;
    status: OrderStatus | string;
    channel: string;
    total_amount: number;
    delivery_fee: number;
    payment_method: PaymentMethod;
    paid: boolean;
    change_for: number | null;
    created_at: string;
    details: string | null;
    customers: { name: string; phone: string; address: string | null } | null;
};

type OrderItemRow = {
    id: string;
    order_id: string;
    product_variant_id: string | null;
    product_name: string | null;
    unit_type: string | null;
    quantity: number;
    unit_price: number;
    line_total: number | null;
    qty: number;
    created_at: string;
};

type OrderFull = OrderRow & { items: OrderItemRow[] };

function formatBRL(n: number | null | undefined) {
    const v = typeof n === "number" ? n : 0;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDT(ts: string) {
    try {
        return new Date(ts).toLocaleString("pt-BR");
    } catch {
        return ts;
    }
}
function prettyStatus(s: string) {
    if (s === "new") return "Novo";
    if (s === "canceled") return "Cancelado";
    if (s === "delivered") return "Entregue";
    if (s === "finalized") return "Finalizado";
    return s;
}
function statusColor(s: string) {
    if (s === "new") return "green";
    if (s === "canceled") return "crimson";
    if (s === "finalized") return "dodgerblue";
    if (s === "delivered") return "#666";
    return "#333";
}
function statusBadgeStyle(s: string): React.CSSProperties {
    const c = statusColor(s);
    return {
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 999,
        fontWeight: 900,
        border: `1px solid ${c}`,
        color: c,
        background: "rgba(0,0,0,0.02)",
        lineHeight: 1,
        fontSize: 12,
        whiteSpace: "nowrap",
    };
}

function calcTroco(total: number, customerPays: number) {
    const t = Number.isFinite(total) ? total : 0;
    const p = Number.isFinite(customerPays) ? customerPays : 0;
    return Math.max(0, p - t);
}

/**
 * ✅ Componente padronizado de pagamento (mesmo conceito do page.tsx)
 * - Cartão: mostra "Levar maquininha"
 * - Dinheiro: mostra "Cliente paga com" e "Levar de troco"
 * - PIX: só mostra PIX (e pago)
 */
function OrderPaymentInfo({
    payment_method,
    paid,
    change_for,
    total_amount,
    compact,
}: {
    payment_method: PaymentMethod | string;
    paid: boolean;
    change_for: number | null;
    total_amount: number | null | undefined;
    compact?: boolean;
}) {
    const pm = String(payment_method) as PaymentMethod | string;
    const label = pm === "pix" ? "PIX" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : pm;

    const total = Number(total_amount ?? 0);
    const customerPays = Number(change_for ?? 0);
    const troco = calcTroco(total, customerPays);

    const strong: React.CSSProperties = { fontWeight: 900, fontSize: compact ? 12 : 12, lineHeight: 1.2 };
    const muted: React.CSSProperties = { color: "#666", fontSize: compact ? 12 : 12, lineHeight: 1.2 };

    if (pm === "card") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Levar maquininha</div>
            </div>
        );
    }

    if (pm === "cash") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Cliente paga com: R$ {formatBRL(customerPays)}</div>
                <div style={muted}>Levar de troco: R$ {formatBRL(troco)}</div>
            </div>
        );
    }

    return (
        <div>
            <div style={strong}>
                {label}
                {paid ? " (pago)" : ""}
            </div>
        </div>
    );
}

function Modal({
    title,
    open,
    onClose,
    children,
}: {
    title: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    if (!open) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "grid",
                placeItems: "center",
                padding: 12,
                zIndex: 9999,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(980px, 100%)",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    padding: 12,
                    maxHeight: "90vh",
                    overflow: "auto",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{ border: "1px solid #ccc", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}
                    >
                        Fechar
                    </button>
                </div>
                <div style={{ marginTop: 10 }}>{children}</div>
            </div>
        </div>
    );
}

function SidebarFallback() {
    return (
        <aside
            style={{
                width: 260,
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 14,
                padding: 12,
                background: "#5B2C8E",
                height: "calc(100vh - 28px)",
                color: "#fff",
            }}
        >
            <div style={{ fontWeight: 900, fontSize: 12, color: "#fff" }}>Carregando...</div>
        </aside>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [order, setOrder] = useState<OrderFull | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    async function fetchOrderFull(orderId: string): Promise<OrderFull | null> {
        const { data: ord, error: ordErr } = await supabase
            .from("orders")
            .select(
                `
        id, status, channel, total_amount, delivery_fee, payment_method, paid, change_for, created_at,
        details,
        customers ( name, phone, address )
      `
            )
            .eq("id", orderId)
            .single();

        if (ordErr) {
            setMsg(`Erro ao carregar pedido: ${ordErr.message}`);
            return null;
        }

        const { data: items, error: itemsErr } = await supabase
            .from("order_items")
            .select(`id, order_id, product_variant_id, product_name, unit_type, quantity, unit_price, line_total, qty, created_at`)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        if (itemsErr) {
            setMsg(`Erro ao carregar itens: ${itemsErr.message}`);
            return null;
        }

        return { ...(ord as any), items: (items as any) ?? [] };
    }

    async function openOrder(orderId: string) {
        setMsg(null);
        setOpen(true);
        setLoading(true);
        setOrder(null);
        const full = await fetchOrderFull(orderId);
        setOrder(full);
        setLoading(false);
    }

    return (
        <AdminOrdersProvider openOrder={openOrder}>
            <div style={{ display: "flex", gap: 12, padding: 14, alignItems: "flex-start", minHeight: "100vh" }}>
                {/* ✅ FIX VERCEL: AdminSidebar usa useSearchParams -> precisa estar dentro de Suspense */}
                <Suspense fallback={<SidebarFallback />}>
                    <AdminSidebar />
                </Suspense>

                <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
            </div>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={order ? `Pedido • ${formatDT(order.created_at)} • ${prettyStatus(String(order.status))}` : "Pedido"}
            >
                {msg ? <p style={{ color: "crimson", marginTop: 0 }}>{msg}</p> : null}

                {loading ? (
                    <p>Carregando...</p>
                ) : !order ? (
                    <p>Nenhum pedido.</p>
                ) : (
                    <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                <div>
                                    <div style={{ fontWeight: 900 }}>{order.customers?.name ?? "-"}</div>
                                    <div style={{ color: "#666" }}>{order.customers?.phone ?? ""}</div>
                                    <div style={{ color: "#666" }}>{order.customers?.address ?? "-"}</div>
                                </div>
                                <span style={statusBadgeStyle(String(order.status))}>{prettyStatus(String(order.status))}</span>
                            </div>

                            {order.details ? (
                                <div style={{ marginTop: 10, fontWeight: 900, fontSize: 14 }}>
                                    OBS: <span style={{ fontWeight: 900 }}>{order.details}</span>
                                </div>
                            ) : null}
                        </div>

                        {/* ✅ Pagamento padronizado */}
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Pagamento</div>
                            <OrderPaymentInfo
                                payment_method={order.payment_method}
                                paid={!!order.paid}
                                change_for={order.change_for}
                                total_amount={order.total_amount}
                            />
                        </div>

                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Itens</div>
                            {order.items.length === 0 ? (
                                <p style={{ color: "#666" }}>Sem itens.</p>
                            ) : (
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr style={{ background: "#f7f7f7" }}>
                                            <th style={{ textAlign: "left", padding: 6 }}>Item</th>
                                            <th style={{ textAlign: "right", padding: 6 }}>Qtd</th>
                                            <th style={{ textAlign: "right", padding: 6 }}>Preço</th>
                                            <th style={{ textAlign: "right", padding: 6 }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {order.items.map((it) => {
                                            const q = Number(it.quantity ?? 0);
                                            const p = Number(it.unit_price ?? 0);
                                            const t = Number(it.line_total ?? q * p);
                                            return (
                                                <tr key={it.id} style={{ borderTop: "1px solid #eee" }}>
                                                    <td style={{ padding: 6 }}>{it.product_name ?? "Item"}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>{q}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(p)}</td>
                                                    <td style={{ padding: 6, textAlign: "right" }}>R$ {formatBRL(t)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}

                            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
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
        </AdminOrdersProvider>
    );
}
