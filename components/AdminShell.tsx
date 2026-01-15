// components/AdminShell.tsx
"use client";

import React, { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AdminOrdersProvider } from "@/components/AdminOrdersContext";
import AdminSidebar from "@/components/AdminSidebar";

/**
 * AdminShell engloba:
 * - AdminOrdersProvider (openOrder)
 * - AdminSidebar
 * - Modal para exibir pedido (fetch via supabase)
 *
 * Ele é usado no app/layout.tsx para disponibilizar o sidebar em
 * todas as páginas (exceto /login).
 */

type OrderFull = any; // mantemos any para compatibilidade

export default function AdminShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    // esconder o shell no login
    if (pathname === "/login") return <>{children}</>;

    const supabase = useMemo(() => createClient(), []);

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [order, setOrder] = useState<OrderFull | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    async function fetchOrderFull(orderId: string) {
        setMsg(null);
        try {
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
        } catch (e: any) {
            setMsg(`Erro ao carregar pedido: ${String(e?.message ?? e)}`);
            return null;
        }
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
            <div style={{ display: "flex", gap: 12, padding: 14, alignItems: "flex-start" }}>
                <AdminSidebar />
                <main style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>{children}</main>
            </div>

            {/* Modal (idêntico ao que estava no layout admin) */}
            {open ? (
                <div
                    onClick={() => setOpen(false)}
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
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>
                                {order ? `Pedido • ${new Date(order.created_at).toLocaleString("pt-BR")} • ${String(order?.status ?? "")}` : "Pedido"}
                            </h3>
                            <button
                                onClick={() => setOpen(false)}
                                style={{ border: "1px solid #ccc", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}
                            >
                                Fechar
                            </button>
                        </div>

                        <div style={{ marginTop: 10 }}>
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
                                        </div>

                                        {order.details ? (
                                            <div style={{ marginTop: 10, fontWeight: 900, fontSize: 14 }}>
                                                OBS: <span style={{ fontWeight: 900 }}>{order.details}</span>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Pagamento</div>
                                        <div>
                                            <div style={{ fontWeight: 900 }}>{order.payment_method}</div>
                                        </div>
                                    </div>

                                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Itens</div>
                                        {order.items?.length === 0 ? (
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
                                                    {order.items.map((it: any) => {
                                                        const q = Number(it.quantity ?? 0);
                                                        const p = Number(it.unit_price ?? 0);
                                                        const t = Number(it.line_total ?? q * p);
                                                        return (
                                                            <tr key={it.id} style={{ borderTop: "1px solid #eee" }}>
                                                                <td style={{ padding: 6 }}>{it.product_name ?? "Item"}</td>
                                                                <td style={{ padding: 6, textAlign: "right" }}>{q}</td>
                                                                <td style={{ padding: 6, textAlign: "right" }}>R$ {p.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                                                <td style={{ padding: 6, textAlign: "right" }}>R$ {t.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}

                                        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span>Taxa de entrega</span>
                                                <b>R$ {Number(order.delivery_fee ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                                <span>Total</span>
                                                <b>R$ {Number(order.total_amount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </AdminOrdersProvider>
    );
}
