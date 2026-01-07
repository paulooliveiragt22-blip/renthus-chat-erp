// components/AdminSidebar.tsx
"use client";

import React, { useEffect, useMemo, useState, useContext } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminOrdersContext } from "./AdminOrdersContext";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";
import OrdersStatsModal from "@/components/OrdersStatsModal";
import MenuButtons from "@/components/MenuButtons";

type OrderStatus = "new" | "canceled" | "delivered" | "finalized";
type CustomerRow = { name: string; phone: string; address: string | null };
type OrderRow = { id: string; status: OrderStatus | string; total_amount: number; created_at: string; customers: CustomerRow | null };
type Thread = { id: string; phone_e164: string; profile_name: string | null; last_message_at: string | null; last_message_preview: string | null };

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
        background: "rgba(255,255,255,0.06)",
        lineHeight: 1,
        fontSize: 12,
        whiteSpace: "nowrap",
    };
}

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";

// sidebar theme colors
const SIDEBAR_BG = PURPLE;
const SIDEBAR_TEXT = "#FFFFFF";
const SIDEBAR_MUTED = "rgba(255,255,255,0.80)";
const SIDEBAR_BORDER = "rgba(255,255,255,0.08)";
const SIDEBAR_CARD_BG = "rgba(255,255,255,0.06)";

function btnBaseSlim(disabled?: boolean): React.CSSProperties {
    return {
        padding: "6px 9px",
        borderRadius: 10,
        border: `1px solid ${SIDEBAR_BORDER}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        color: SIDEBAR_TEXT,
        background: "transparent",
    };
}
function btnOrangeOutline(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${ORANGE}`,
        background: "transparent",
        color: SIDEBAR_TEXT,
    };
}
function btnPurpleOutline(active?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(false),
        border: `1px solid ${PURPLE}`,
        background: active ? SIDEBAR_CARD_BG : "transparent",
        color: SIDEBAR_TEXT,
    };
}

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
    const adminOrdersCtx = useContext(AdminOrdersContext);
    const openOrder = adminOrdersCtx?.openOrder;

    const [selected, setSelected] = useState<OrderStatus | null>(null);

    useEffect(() => {
        try {
            const sp = new URLSearchParams(window.location.search);
            const s = sp.get("status");
            if (s === "new" || s === "delivered" || s === "finalized" || s === "canceled") {
                setSelected(s as OrderStatus);
            } else {
                setSelected(null);
            }
        } catch {
            setSelected(null);
        }
    }, []);

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);
    const [tab, setTab] = useState<"orders" | "whatsapp">("orders");
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(false);
    const [threadsMsg, setThreadsMsg] = useState<string | null>(null);
    const [openThread, setOpenThread] = useState<Thread | null>(null);
    const [showStats, setShowStats] = useState(false);
    const [collapsed, setCollapsed] = useState<boolean>(false);

    async function loadOrders() {
        setLoading(true);
        setMsg(null);
        try {
            const url = new URL("/api/orders/list", window.location.origin);
            url.searchParams.set("limit", "120");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json?.error ?? "Erro ao carregar pedidos");
                setOrders([]);
                setLoading(false);
                return;
            }
            setOrders(normalizeOrders(json.orders));
        } catch (e) {
            console.error(e);
            setMsg("Falha ao carregar pedidos");
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }

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
        } catch (e) {
            console.error(e);
            setThreadsMsg("Falha ao carregar conversas");
            setThreads([]);
        } finally {
            setLoadingThreads(false);
        }
    }

    useEffect(() => {
        async function ensureWorkspaceSelectedAndLoad() {
            try {
                const listRes = await fetch("/api/workspace/list", { credentials: "include" });
                const listJson = await listRes.json().catch(() => ({ companies: [] }));
                const companies = Array.isArray(listJson.companies) ? listJson.companies : [];
                if (companies.length === 1) {
                    try {
                        await fetch("/api/workspace/select", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ company_id: companies[0].id }),
                        });
                    } catch (err) {
                        console.warn("workspace/select failed", err);
                    }
                }
            } catch (e) {
                console.warn("auto-select workspace failed", e);
            } finally {
                loadOrders();
            }
        }
        ensureWorkspaceSelectedAndLoad();
    }, []);

    useEffect(() => {
        const id = window.setInterval(() => {
            loadOrders();
        }, 10000);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (tab === "whatsapp") {
            loadThreads();
            const id = window.setInterval(() => {
                loadThreads();
            }, 10000);
            return () => window.clearInterval(id);
        }
        return;
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
            border: `1px solid ${SIDEBAR_BORDER}`,
            borderRadius: 12,
            padding: 10,
            background: active ? SIDEBAR_CARD_BG : "transparent",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            boxSizing: "border-box",
            color: SIDEBAR_TEXT,
        };
    }

    const filtered = useMemo(() => {
        if (!selected) return orders;
        return orders.filter((o) => String(o.status) === selected);
    }, [orders, selected]);

    const latest = useMemo(() => filtered.slice(0, 8), [filtered]);

    const latestThreads = useMemo(() => {
        const sorted = threads.slice().sort((a, b) => {
            const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return db - da;
        });
        return sorted.slice(0, 8);
    }, [threads]);

    const width = collapsed ? 80 : 260;

    return (
        <aside
            style={{
                position: "sticky",
                top: 14,
                height: "calc(100vh - 28px)",
                width,
                maxWidth: width,
                border: `1px solid ${SIDEBAR_BORDER}`,
                borderRadius: 14,
                padding: 12,
                background: SIDEBAR_BG,
                color: SIDEBAR_TEXT,
                overflowY: "auto",
                overflowX: "hidden",
                boxSizing: "border-box",
                transition: "width 180ms ease",
            }}
        >
            {/* Header + toggle */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                {!collapsed ? <div style={{ fontWeight: 900, fontSize: 12, color: SIDEBAR_TEXT }}>Dashboard</div> : <div aria-hidden />}
                <div>
                    <button
                        onClick={() => setCollapsed((s) => !s)}
                        title={collapsed ? "Expandir painel" : "Colapsar painel"}
                        style={{
                            border: `1px solid ${SIDEBAR_BORDER}`,
                            background: collapsed ? SIDEBAR_BG : SIDEBAR_CARD_BG,
                            color: SIDEBAR_TEXT,
                            borderRadius: 8,
                            padding: "6px",
                            cursor: "pointer",
                        }}
                        type="button"
                    >
                        {collapsed ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M8 5l8 7-8 7" stroke={SIDEBAR_TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M16 5l-8 7 8 7" stroke={SIDEBAR_TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Workspace switcher */}
            {!collapsed ? (
                <div style={{ marginTop: 10 }}>
                    <WorkspaceSwitcher />
                </div>
            ) : null}

            {/* Botões principais */}
            <div style={{ marginTop: 12 }}>
                {/* passamos textColor branco e iconColor laranja */}
                <MenuButtons compact={collapsed} onNavigate={() => { }} textColor={SIDEBAR_TEXT} iconColor={ORANGE} />
            </div>

            {/* Estatísticas / cards */}
            {!collapsed ? (
                <>
                    <div style={{ marginTop: 12, borderTop: `1px solid ${SIDEBAR_BORDER}`, paddingTop: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={cardStyle(selected === "new")}>
                                <div style={{ fontSize: 11, color: SIDEBAR_MUTED }}>Novos</div>
                                <div style={{ fontWeight: 900, color: statusColor("new"), fontSize: 16 }}>{stats.new}</div>
                            </div>
                            <div style={cardStyle(selected === "delivered")}>
                                <div style={{ fontSize: 11, color: SIDEBAR_MUTED }}>Entregues</div>
                                <div style={{ fontWeight: 900, color: statusColor("delivered"), fontSize: 16 }}>{stats.delivered}</div>
                            </div>
                            <div style={cardStyle(selected === "finalized")}>
                                <div style={{ fontSize: 11, color: SIDEBAR_MUTED }}>Finalizados</div>
                                <div style={{ fontWeight: 900, color: statusColor("finalized"), fontSize: 16 }}>{stats.finalized}</div>
                            </div>
                            <div style={cardStyle(selected === "canceled")}>
                                <div style={{ fontSize: 11, color: SIDEBAR_MUTED }}>Cancelados</div>
                                <div style={{ fontWeight: 900, color: statusColor("canceled"), fontSize: 16 }}>{stats.canceled}</div>
                            </div>
                        </div>
                        {loading ? <div style={{ marginTop: 10, fontSize: 12, color: SIDEBAR_MUTED }}>Carregando...</div> : null}
                    </div>

                    {/* Chips (Pedidos / WhatsApp) */}
                    <div style={{ marginTop: 12, borderTop: `1px solid ${SIDEBAR_BORDER}`, paddingTop: 10 }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-start", alignItems: "center" }}>
                            <button onClick={() => setTab("orders")} style={{ ...btnPurpleOutline(tab === "orders"), padding: "6px 8px", fontSize: 11, color: SIDEBAR_TEXT }}>
                                Pedidos ({filtered.length})
                            </button>
                            <button onClick={() => setTab("whatsapp")} style={{ ...btnPurpleOutline(tab === "whatsapp"), padding: "6px 8px", fontSize: 11, color: SIDEBAR_TEXT }}>
                                WhatsApp ({threads.length})
                            </button>
                        </div>

                        {/* Aba conteúdo */}
                        {tab === "orders" ? (
                            <>
                                {latest.length === 0 ? (
                                    <div style={{ marginTop: 8, fontSize: 12, color: SIDEBAR_MUTED }}>Nenhum pedido.</div>
                                ) : (
                                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                        {latest.map((o) => {
                                            const name = o.customers?.name ?? "-";
                                            const st = String(o.status);
                                            return (
                                                <button
                                                    key={o.id}
                                                    type="button"
                                                    onClick={() => (openOrder ? openOrder(o.id) : null)}
                                                    style={{
                                                        width: "100%",
                                                        textAlign: "left",
                                                        border: `1px solid ${SIDEBAR_BORDER}`,
                                                        borderRadius: 12,
                                                        padding: 10,
                                                        cursor: "pointer",
                                                        background: SIDEBAR_CARD_BG,
                                                        boxSizing: "border-box",
                                                        color: SIDEBAR_TEXT,
                                                    }}
                                                    title="Abrir pedido"
                                                >
                                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", minWidth: 0 }}>
                                                        <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                                                            {name}
                                                        </div>
                                                        <span style={{ ...statusBadgeStyle(st), fontSize: 11, padding: "3px 7px" }}>{prettyStatus(st)}</span>
                                                    </div>
                                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                                                        <span style={{ fontSize: 11, color: SIDEBAR_MUTED, whiteSpace: "nowrap" }}>{formatDT(o.created_at)}</span>
                                                        <span style={{ fontSize: 11, color: SIDEBAR_TEXT, fontWeight: 900, whiteSpace: "nowrap" }}>R$ {formatBRL(o.total_amount)}</span>
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
                                    <div style={{ marginTop: 8, fontSize: 12, color: SIDEBAR_MUTED }}>Carregando conversas...</div>
                                ) : threads.length === 0 ? (
                                    <div style={{ marginTop: 8, fontSize: 12, color: SIDEBAR_MUTED }}>Nenhuma conversa.</div>
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
                                                        border: `1px solid ${SIDEBAR_BORDER}`,
                                                        borderRadius: 12,
                                                        padding: 10,
                                                        cursor: "pointer",
                                                        background: SIDEBAR_CARD_BG,
                                                        boxSizing: "border-box",
                                                        color: SIDEBAR_TEXT,
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {t.profile_name || t.phone_e164}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: SIDEBAR_MUTED, marginTop: 2 }}>{t.phone_e164}</div>
                                                    <div style={{ fontSize: 11, color: SIDEBAR_MUTED, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {t.last_message_preview || "(sem mensagens)"}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{t.last_message_at ? formatDT(t.last_message_at) : ""}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {openThread ? <QuickReplyModal thread={openThread} onClose={() => setOpenThread(null)} /> : null}
                    {showStats ? <OrdersStatsModal open={showStats} onClose={() => setShowStats(false)} /> : null}
                </>
            ) : null}
        </aside>
    );
}
