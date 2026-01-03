"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminOrders } from "@/components/AdminOrdersContext";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";

// Possíveis status de um pedido (order)
type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

type CustomerRow = { name: string; phone: string; address: string | null };

type OrderRow = {
    id: string;
    status: OrderStatus | string;
    total_amount: number;
    created_at: string;
    customers: CustomerRow | null;
};

// Modelo de uma conversa (thread) do WhatsApp. Inclui campos básicos
// retornados pelo endpoint de threads.  O campo last_message_read_at não
// é retornado pelo endpoint atual, mas poderá ser usado futuramente
// para ordenar conversas não lidas.
type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
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

/**
 * Normaliza o retorno do Supabase:
 * - às vezes `customers` vem como array (customers: [{...}])
 * - às vezes vem como objeto (customers: {...})
 * Aqui garantimos `customers: CustomerRow | null` e tipos seguros pro build.
 */
function normalizeOrders(input: unknown): OrderRow[] {
    const arr = Array.isArray(input) ? input : [];
    return arr.map((o: any) => {
        const rawCustomers = o?.customers;
        const c: CustomerRow | null = Array.isArray(rawCustomers)
            ? rawCustomers[0]
                ? {
                    name: String(rawCustomers[0]?.name ?? ""),
                    phone: String(rawCustomers[0]?.phone ?? ""),
                    address: (rawCustomers[0]?.address ?? null) as string | null,
                }
                : null
            : rawCustomers
                ? {
                    name: String(rawCustomers?.name ?? ""),
                    phone: String(rawCustomers?.phone ?? ""),
                    address: (rawCustomers?.address ?? null) as string | null,
                }
                : null;
        return {
            id: String(o?.id),
            status: String(o?.status ?? ""),
            total_amount: Number(o?.total_amount ?? 0),
            created_at: String(o?.created_at ?? ""),
            customers: c,
        };
    });
}

export default function AdminSidebar() {
    const router = useRouter();
    const sp = useSearchParams();
    const { openOrder } = useAdminOrders();
    const [selected, setSelected] = useState<OrderStatus | null>((sp.get("status") as OrderStatus | null) ?? null);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);
    // Estado para alternar entre a lista de pedidos e a lista de conversas
    const [tab, setTab] = useState<"orders" | "whatsapp">("orders");
    // Lista de conversas
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(false);
    const [threadsMsg, setThreadsMsg] = useState<string | null>(null);
    // Thread selecionada no modal de resposta rápida
    const [openThread, setOpenThread] = useState<Thread | null>(null);

    async function loadOrders() {
        setLoading(true);
        setMsg(null);
        const url = new URL("/api/orders/list", window.location.origin);
        url.searchParams.set("limit", "120");
        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMsg(json?.error ?? "Erro ao carregar pedidos");
            setOrders([]);
            setLoading(false);
            return;
        }
        setOrders(normalizeOrders(json.orders));
        setLoading(false);
    }

    // Carrega conversas (threads) do WhatsApp
    async function loadThreads() {
        setLoadingThreads(true);
        setThreadsMsg(null);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "30");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setThreadsMsg(json?.error ?? "Erro ao carregar conversas");
                setThreads([]);
                setLoadingThreads(false);
                return;
            }
            setThreads(Array.isArray(json.threads) ? json.threads : []);
            setLoadingThreads(false);
        } catch (e) {
            console.error(e);
            setThreadsMsg("Falha ao carregar conversas");
            setThreads([]);
            setLoadingThreads(false);
        }
    }

    // Carrega pedidos ao montar
    useEffect(() => {
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Polling leve para pedidos
    useEffect(() => {
        const id = window.setInterval(() => {
            loadOrders();
        }, 10000);
        return () => window.clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Carrega conversas quando a aba muda para whatsapp
    useEffect(() => {
        if (tab === "whatsapp") {
            loadThreads();
            const id = window.setInterval(() => {
                loadThreads();
            }, 10000);
            return () => window.clearInterval(id);
        }
        return;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const stats = useMemo(() => {
        const by = { new: 0, delivered: 0, finalized: 0, canceled: 0 } as Record<OrderStatus, number>;
        for (const o of orders) {
            const s = String(o.status) as OrderStatus;
            if (by[s] !== undefined) by[s] += 1;
        }
        return { total: orders.length, ...by };
    }, [orders]);

    function goStatus(s: OrderStatus | "all") {
        if (s === "all") setSelected(null);
        else setSelected(s);
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
            boxSizing: "border-box",
        };
    }

    const filtered = useMemo(() => {
        if (!selected) return orders;
        return orders.filter((o) => String(o.status) === selected);
    }, [orders, selected]);

    const latest = useMemo(() => filtered.slice(0, 8), [filtered]);

    // Ordena conversas por data da última mensagem (desc). Mostra apenas as 8 mais recentes
    const latestThreads = useMemo(() => {
        const sorted = threads.slice().sort((a, b) => {
            const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return db - da;
        });
        return sorted.slice(0, 8);
    }, [threads]);

    function labelSelected() {
        if (!selected) return "Todos";
        return String(prettyStatus(selected));
    }

    return (
        <aside
            style={{
                position: "sticky",
                top: 14,
                height: "calc(100vh - 28px)",
                width: 260,
                maxWidth: 260,
                border: "1px solid #e6e6e6",
                borderRadius: 14,
                padding: 12,
                background: "#fff",
                overflowY: "auto",
                overflowX: "hidden",
                boxSizing: "border-box",
            }}
        >
            {/* Workspace */}
            <div style={{ marginBottom: 10 }}>
                <WorkspaceSwitcher />
            </div>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 12, color: "#111" }}>Dashboard</div>
            </div>

            {/* Botões principais */}
            <Link href="/whatsapp" style={{ textDecoration: "none" }}>
                <button style={{ /* estilo do WhatsApp */ width: "100%", marginTop: 8 }}>
                    WhatsApp
                </button>
            </Link>

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

            {/* Cards */}
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

            {/* Lista inferior com toggle Pedidos/WhatsApp */}
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>Acompanhar</div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            onClick={() => setTab("orders")}
                            style={{ ...btnPurpleOutline(tab === "orders"), padding: "6px 8px", fontSize: 11 }}
                        >
                            Pedidos ({filtered.length})
                        </button>
                        <button
                            onClick={() => setTab("whatsapp")}
                            style={{ ...btnPurpleOutline(tab === "whatsapp"), padding: "6px 8px", fontSize: 11 }}
                        >
                            WhatsApp ({threads.length})
                        </button>
                    </div>
                </div>
                {tab === "orders" ? (
                    <>
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
                                            type="button"
                                            onClick={() => openOrder(o.id)}
                                            style={{
                                                width: "100%",
                                                textAlign: "left",
                                                border: "1px solid #eee",
                                                borderRadius: 12,
                                                padding: 10,
                                                cursor: "pointer",
                                                background: "#fff",
                                                boxSizing: "border-box",
                                            }}
                                            title="Abrir pedido"
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", minWidth: 0 }}>
                                                <div
                                                    style={{
                                                        fontWeight: 900,
                                                        fontSize: 12,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        minWidth: 0,
                                                    }}
                                                >
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
                    </>
                ) : (
                    <>
                        {loadingThreads ? (
                            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Carregando conversas...</div>
                        ) : threads.length === 0 ? (
                            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Nenhuma conversa.</div>
                        ) : (
                            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                {latestThreads.map((t) => {
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setOpenThread(t)}
                                            style={{
                                                width: "100%",
                                                textAlign: "left",
                                                border: "1px solid #eee",
                                                borderRadius: 12,
                                                padding: 10,
                                                cursor: "pointer",
                                                background: "#fff",
                                                boxSizing: "border-box",
                                            }}
                                        >
                                            <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {t.profile_name || t.phone_e164}
                                            </div>
                                            <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
                                                {t.phone_e164}
                                            </div>
                                            <div style={{ fontSize: 11, color: "#666", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {t.last_message_preview || "(sem mensagens)"}
                                            </div>
                                            <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                                                {t.last_message_at ? formatDT(t.last_message_at) : ""}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {/* Não há botão de lista completa para WhatsApp na sidebar */}
                    </>
                )}
            </div>

            {/* Modal de resposta rápida */}
            {openThread ? (
                <QuickReplyModal thread={openThread} onClose={() => setOpenThread(null)} />
            ) : null}
        </aside>
    );
}