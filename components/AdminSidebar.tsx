// components/AdminSidebar.tsx
"use client";

import React, { useEffect, useMemo, useState, useContext } from "react";
import { useRouter } from "next/navigation";
import { AdminOrdersContext } from "./AdminOrdersContext";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";
import OrdersStatsModal from "@/components/OrdersStatsModal";
import MenuButtons from "@/components/MenuButtons";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

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

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";

// sidebar theme colors
const SIDEBAR_BG = PURPLE;
const SIDEBAR_TEXT = "#FFFFFF";
const SIDEBAR_MUTED = "rgba(255,255,255,0.80)";
const SIDEBAR_BORDER = "rgba(255,255,255,0.08)";
const SIDEBAR_CARD_BG = "rgba(255,255,255,0.06)";

/* SIZE / TYPOGRAPHY (compact) - ajustado para caber no painel */
const CARD_PADDING = 6;
const CARD_RADIUS = 8;
const CARD_GAP = 6;
const NAME_FONT = 11;
const MSG_FONT = 10;
const DATE_FONT = 9;
const CHIP_FONT = 11;

function btnBaseSlim(disabled?: boolean): React.CSSProperties {
    return {
        padding: "4px 8px",
        borderRadius: 10,
        border: `1px solid ${SIDEBAR_BORDER}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: CHIP_FONT,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        color: SIDEBAR_TEXT,
        background: "transparent",
    };
}

function chipOrangeStyle(active?: boolean): React.CSSProperties {
    if (active) {
        return {
            borderRadius: 999,
            padding: "5px 8px",
            background: ORANGE,
            color: "#fff",
            fontWeight: 800,
            border: `1px solid ${ORANGE}`,
            fontSize: CHIP_FONT,
        };
    }
    return {
        borderRadius: 999,
        padding: "5px 8px",
        background: "transparent",
        color: ORANGE,
        fontWeight: 800,
        border: `1px solid ${ORANGE}`,
        fontSize: CHIP_FONT,
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

    // fonte única de verdade
    const { companies, currentCompanyId, currentCompany, loading: loadingWorkspace, reload: reloadWorkspace } = useWorkspace();

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
    const [openThread, setOpenThread] = useState<Thread | null>(null);
    const [showStats, setShowStats] = useState(false);
    const [collapsed, setCollapsed] = useState<boolean>(false);

    async function loadOrders() {
        if (!currentCompanyId) {
            setOrders([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setMsg(null);
        try {
            const url = new URL("/api/orders/list", window.location.origin);
            url.searchParams.set("limit", "120");
            // garante envio do cookie HTTP-only
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
        if (!currentCompanyId) {
            setThreads([]);
            return;
        }
        setLoadingThreads(true);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "30");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setThreads([]);
                setLoadingThreads(false);
                return;
            }
            setThreads(Array.isArray(json.threads) ? json.threads : []);
        } catch (e) {
            console.error(e);
            setThreads([]);
        } finally {
            setLoadingThreads(false);
        }
    }

    // auto-select e carregamento dependente do workspace
    useEffect(() => {
        if (loadingWorkspace) return;

        if (!currentCompanyId && companies && companies.length === 1) {
            (async () => {
                try {
                    const res = await fetch("/api/workspace/select", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ company_id: companies[0].id }),
                    });

                    if (!res.ok) {
                        console.warn("auto-select workspace failed");
                        return;
                    }

                    await reloadWorkspace();
                    try { router.refresh(); } catch { }
                    await loadOrders();
                } catch (e) {
                    console.warn("auto-select workspace exception", e);
                }
            })();
            return;
        }

        if (currentCompanyId) {
            loadOrders();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadingWorkspace, companies, currentCompanyId]);

    useEffect(() => {
        const id = window.setInterval(() => {
            if (currentCompanyId) loadOrders();
        }, 10000);
        return () => window.clearInterval(id);
    }, [currentCompanyId]);

    useEffect(() => {
        if (tab === "whatsapp") {
            loadThreads();
            const id = window.setInterval(() => {
                if (currentCompanyId) loadThreads();
            }, 10000);
            return () => window.clearInterval(id);
        }
        return;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, currentCompanyId]);

    // somente os pedidos novos
    const newOrders = useMemo(() => orders.filter((o) => String(o.status) === "new"), [orders]);
    const newOrdersCount = newOrders.length;
    const newMessagesCount = threads.length; // se tiver flag de unread, trocar por threads.filter(...).length

    const latestNewOrders = useMemo(() => newOrders.slice(0, 6), [newOrders]);
    const latestThreads = useMemo(() => {
        const sorted = threads.slice().sort((a, b) => {
            const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return db - da;
        });
        return sorted.slice(0, 6);
    }, [threads]);

    const width = collapsed ? 80 : 240;

    // hide scrollbar visually while keeping scroll functionality
    return (
        <>
            <style>{`
        .renthus-sidebar { -ms-overflow-style: none; scrollbar-width: none; }
        .renthus-sidebar::-webkit-scrollbar { width: 0px; height: 0px; }
      `}</style>

            <aside
                className="renthus-sidebar"
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
                    {!collapsed ? <div style={{ fontWeight: 900, fontSize: 13, color: SIDEBAR_TEXT }}>Dashboard</div> : <div aria-hidden />}
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

                {/* Company chip (fonte única da verdade) */}
                {!collapsed ? (
                    <div style={{ marginTop: 10 }}>
                        {loadingWorkspace ? (
                            <div style={{ fontSize: 12, color: SIDEBAR_MUTED }}>Carregando empresa...</div>
                        ) : currentCompany ? (
                            <div style={{ display: "inline-block", marginBottom: 8 }}>
                                <span style={{ borderRadius: 999, padding: "6px 10px", background: "rgba(255,255,255,0.06)", color: SIDEBAR_TEXT, fontWeight: 800 }}>
                                    {currentCompany.name}
                                </span>
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, color: SIDEBAR_MUTED }}>Nenhuma empresa disponível</div>
                        )}
                    </div>
                ) : null}

                {/* Botões principais */}
                <div style={{ marginTop: 10 }}>
                    <MenuButtons compact={collapsed} onNavigate={() => { }} textColor={SIDEBAR_TEXT} iconColor={ORANGE} />
                </div>

                {/* Chips laranjas (Pedidos / WhatsApp) e conteúdo da aba */}
                {!collapsed ? (
                    <>
                        <div style={{ marginTop: 12, borderTop: `1px solid ${SIDEBAR_BORDER}`, paddingTop: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button
                                    onClick={() => setTab("orders")}
                                    style={tab === "orders" ? chipOrangeStyle(true) : chipOrangeStyle(false)}
                                >
                                    Pedidos ({newOrdersCount})
                                </button>

                                <button
                                    onClick={() => setTab("whatsapp")}
                                    style={tab === "whatsapp" ? chipOrangeStyle(true) : chipOrangeStyle(false)}
                                >
                                    WhatsApp ({newMessagesCount})
                                </button>
                            </div>

                            <div style={{ marginTop: 10 }}>
                                {/* Orders tab shows only new orders */}
                                {tab === "orders" ? (
                                    <>
                                        {loading ? (
                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED }}>Carregando...</div>
                                        ) : newOrdersCount === 0 ? (
                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED }}>Nenhum pedido novo.</div>
                                        ) : (
                                            <div style={{ display: "grid", gap: CARD_GAP }}>
                                                {latestNewOrders.map((o) => {
                                                    const name = o.customers?.name ?? "-";
                                                    return (
                                                        <button
                                                            key={o.id}
                                                            type="button"
                                                            onClick={() => (openOrder ? openOrder(o.id) : null)}
                                                            style={{
                                                                width: "100%",
                                                                textAlign: "left",
                                                                border: `1px solid ${SIDEBAR_BORDER}`,
                                                                borderRadius: CARD_RADIUS,
                                                                padding: CARD_PADDING,
                                                                cursor: "pointer",
                                                                background: SIDEBAR_CARD_BG,
                                                                boxSizing: "border-box",
                                                                color: SIDEBAR_TEXT,
                                                                display: "block",
                                                            }}
                                                            title="Abrir pedido"
                                                        >
                                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", minWidth: 0 }}>
                                                                <div style={{ fontWeight: 900, fontSize: NAME_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{name}</div>
                                                                <span style={{ fontSize: 11, padding: "3px 6px" }}>
                                                                    <span style={{ borderRadius: 999, padding: "3px 6px", fontWeight: 900, color: statusColor("new"), border: `1px solid ${statusColor("new")}`, background: "rgba(255,255,255,0.02)" }}>
                                                                        Novo
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                                                                <span style={{ fontSize: DATE_FONT, color: SIDEBAR_MUTED, whiteSpace: "nowrap" }}>{formatDT(o.created_at)}</span>
                                                                <span style={{ fontSize: MSG_FONT, color: SIDEBAR_TEXT, fontWeight: 900 }}>R$ {formatBRL(o.total_amount)}</span>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <div style={{ marginTop: 8 }}>
                                            <button onClick={() => router.push("/pedidos")} style={{ ...btnBaseSlim(false), width: "100%", fontSize: CHIP_FONT }}>
                                                Abrir lista completa
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    // WhatsApp tab: threads
                                    <>
                                        {loadingThreads ? (
                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED }}>Carregando...</div>
                                        ) : threads.length === 0 ? (
                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED }}>Nenhuma conversa.</div>
                                        ) : (
                                            <div style={{ display: "grid", gap: CARD_GAP }}>
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
                                                                borderRadius: CARD_RADIUS,
                                                                padding: CARD_PADDING,
                                                                cursor: "pointer",
                                                                background: SIDEBAR_CARD_BG,
                                                                boxSizing: "border-box",
                                                                color: SIDEBAR_TEXT,
                                                                display: "block",
                                                            }}
                                                        >
                                                            <div style={{ fontWeight: 900, fontSize: NAME_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                                {t.profile_name || t.phone_e164}
                                                            </div>
                                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED, marginTop: 2 }}>{t.phone_e164}</div>
                                                            <div style={{ fontSize: MSG_FONT, color: SIDEBAR_MUTED, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.last_message_preview || "(sem mensagens)"}</div>
                                                            <div style={{ fontSize: DATE_FONT, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>{t.last_message_at ? formatDT(t.last_message_at) : ""}</div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {openThread ? <QuickReplyModal thread={openThread} onClose={() => setOpenThread(null)} /> : null}
                        {showStats ? <OrdersStatsModal open={showStats} onClose={() => setShowStats(false)} /> : null}
                    </>
                ) : null}
            </aside>
        </>
    );
}
