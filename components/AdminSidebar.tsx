"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAdminOrders } from "@/components/AdminOrdersContext";

type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

type OrderRow = {
    id: string;
    status: OrderStatus | string;
    total_amount: number;
    created_at: string;
    customers: { name: string; phone: string; address: string | null } | null;
};

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

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";

function btnBaseSlim(disabled?: boolean): React.CSSProperties {
    return {
        padding: "6px 9px",
        borderRadius: 10,
        border: "1px solid #999",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
    };
}

function btnOrange(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${ORANGE}`,
        background: disabled ? "#fff3ea" : ORANGE,
        color: disabled ? ORANGE : "#fff",
    };
}

function btnOrangeOutline(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${ORANGE}`,
        background: "transparent",
        color: ORANGE,
    };
}

function btnPurpleOutline(active?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(false),
        border: `1px solid ${PURPLE}`,
        background: active ? "#f5f1fb" : "transparent",
        color: PURPLE,
    };
}

export default function AdminSidebar() {
    const supabase = useMemo(() => createClient(), []);
    const router = useRouter();
    const sp = useSearchParams();
    const { openOrder } = useAdminOrders();

    const selected = (sp.get("status") as OrderStatus | null) ?? null;

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);

    async function loadOrders() {
        setLoading(true);
        setMsg(null);

        const { data, error } = await supabase
            .from("orders")
            .select(
                `
        id, status, total_amount, created_at,
        customers ( name, phone, address )
      `
            )
            .order("created_at", { ascending: false })
            .limit(120);

        if (error) {
            setMsg(`Erro ao carregar pedidos: ${error.message}`);
            setOrders([]);
            setLoading(false);
            return;
        }

        setOrders((data as OrderRow[]) ?? []);
        setLoading(false);
    }

    useEffect(() => {
        loadOrders();

        // ✅ Realtime: acompanha pedidos mesmo em outras abas
        const channel = supabase
            .channel("orders-live")
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
                loadOrders();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stats = useMemo(() => {
        const by = { new: 0, delivered: 0, finalized: 0, canceled: 0 } as Record<OrderStatus, number>;
        for (const o of orders) {
            const s = String(o.status) as OrderStatus;
            if (by[s] !== undefined) by[s] += 1;
        }
        return { total: orders.length, ...by };
    }, [orders]);

    function goStatus(s: OrderStatus | "all") {
        if (s === "all") router.push("/pedidos");
        else router.push(`/pedidos?status=${encodeURIComponent(s)}`);
    }

    function cardStyle(active: boolean): React.CSSProperties {
        return {
            border: `1px solid ${active ? PURPLE : "#eee"}`,
            borderRadius: 12,
            padding: 10,
            background: active ? "#f5f1fb" : "#fff",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
        };
    }

    const filtered = useMemo(() => {
        if (!selected) return orders;
        return orders.filter((o) => String(o.status) === selected);
    }, [orders, selected]);

    const latest = useMemo(() => filtered.slice(0, 8), [filtered]);

    function labelSelected() {
        if (!selected) return "Todos";
        return prettyStatus(selected);
    }

    return (
        <aside
            style={{
                position: "sticky",
                top: 14,
                height: "calc(100vh - 28px)",
                width: 260,
                border: "1px solid #e6e6e6",
                borderRadius: 14,
                padding: 12,
                background: "#fff",
                overflow: "auto",
            }}
        >
            <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 10, color: "#111" }}>Dashboard</div>

            {/* ✅ Botões principais */}
            <Link href="/produtos" style={{ textDecoration: "none" }}>
                <button style={{ ...btnOrange(false), width: "100%", padding: "10px 10px", borderRadius: 12, fontSize: 12 }}>
                    Cadastrar produto
                </button>
            </Link>

            <Link href="/produtos/lista" style={{ textDecoration: "none" }}>
                <button
                    style={{
                        ...btnOrangeOutline(false),
                        width: "100%",
                        marginTop: 8,
                        padding: "10px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                    }}
                >
                    Produtos
                </button>
            </Link>

            {/* ✅ NOVO: botão Pedidos */}
            <Link href="/pedidos" style={{ textDecoration: "none" }}>
                <button
                    style={{
                        ...btnOrangeOutline(false),
                        width: "100%",
                        marginTop: 8,
                        padding: "10px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                    }}
                >
                    Pedidos
                </button>
            </Link>

            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <button onClick={loadOrders} style={{ ...btnOrangeOutline(false), width: "100%" }}>
                    Recarregar
                </button>
            </div>

            {/* ✅ Cards de status */}
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>Pedidos</div>
                    <button onClick={() => goStatus("all")} style={{ ...btnOrangeOutline(false), padding: "6px 8px", fontSize: 11 }}>
                        Ver todos ({stats.total})
                    </button>
                </div>

                {msg ? <div style={{ marginTop: 8, color: "crimson", fontSize: 12 }}>{msg}</div> : null}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                    <button onClick={() => goStatus("new")} style={cardStyle(selected === "new")} title="Filtrar: Novo">
                        <div style={{ fontSize: 11, color: "#666" }}>Novos</div>
                        <div style={{ fontWeight: 900, color: statusColor("new"), fontSize: 16 }}>{stats.new}</div>
                    </button>

                    <button onClick={() => goStatus("delivered")} style={cardStyle(selected === "delivered")} title="Filtrar: Entregue">
                        <div style={{ fontSize: 11, color: "#666" }}>Entregues</div>
                        <div style={{ fontWeight: 900, color: statusColor("delivered"), fontSize: 16 }}>{stats.delivered}</div>
                    </button>

                    <button onClick={() => goStatus("finalized")} style={cardStyle(selected === "finalized")} title="Filtrar: Finalizado">
                        <div style={{ fontSize: 11, color: "#666" }}>Finalizados</div>
                        <div style={{ fontWeight: 900, color: statusColor("finalized"), fontSize: 16 }}>{stats.finalized}</div>
                    </button>

                    <button onClick={() => goStatus("canceled")} style={cardStyle(selected === "canceled")} title="Filtrar: Cancelado">
                        <div style={{ fontSize: 11, color: "#666" }}>Cancelados</div>
                        <div style={{ fontWeight: 900, color: statusColor("canceled"), fontSize: 16 }}>{stats.canceled}</div>
                    </button>
                </div>

                {loading ? <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>Carregando...</div> : null}
            </div>

            {/* ✅ Lista abaixo dos cards: acompanha em qualquer aba + abre modal */}
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>Acompanhar</div>
                    <button onClick={() => goStatus("all")} style={{ ...btnPurpleOutline(!selected), padding: "6px 8px", fontSize: 11 }}>
                        {labelSelected()} ({filtered.length})
                    </button>
                </div>

                {latest.length === 0 ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Nenhum pedido.</div>
                ) : (
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        {latest.map((o) => {
                            const name = o.customers?.name ?? "-";
                            const st = String(o.status);

                            return (
                                <button
                                    key={o.id}
                                    onClick={() => openOrder(o.id)}
                                    style={{
                                        width: "100%",
                                        textAlign: "left",
                                        border: "1px solid #eee",
                                        borderRadius: 12,
                                        padding: 10,
                                        cursor: "pointer",
                                        background: "#fff",
                                    }}
                                    title="Abrir pedido"
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                        <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {name}
                                        </div>
                                        <span style={{ ...statusBadgeStyle(st), fontSize: 11, padding: "3px 7px" }}>{prettyStatus(st)}</span>
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                                        <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>{formatDT(o.created_at)}</span>
                                        <span style={{ fontSize: 11, color: "#111", fontWeight: 900, whiteSpace: "nowrap" }}>
                                            R$ {formatBRL(o.total_amount)}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div style={{ marginTop: 10 }}>
                    <button onClick={() => router.push("/pedidos")} style={{ ...btnOrangeOutline(false), width: "100%" }}>
                        Abrir lista completa
                    </button>
                </div>
            </div>
        </aside>
    );
}
