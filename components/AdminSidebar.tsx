// components/AdminSidebar.tsx
"use client";

import React, { useEffect, useMemo, useState, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FiHome, FiShoppingCart } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { AiOutlinePlusSquare } from "react-icons/ai";
import { GiCube } from "react-icons/gi";
import { BiBarChart } from "react-icons/bi";

import { AdminOrdersContext } from "./AdminOrdersContext";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";
import OrdersStatsModal from "@/components/OrdersStatsModal";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

type OrderStatus = "new" | "canceled" | "delivered" | "finalized";
type CustomerRow = { name: string; phone: string; address: string | null };
type OrderRow = { id: string; status: OrderStatus | string; total_amount: number; created_at: string; customers: CustomerRow | null };
type Thread = { id: string; phone_e164: string; profile_name: string | null; last_message_at: string | null; last_message_preview: string | null };

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";
const SIDEBAR_BG = PURPLE;
const SIDEBAR_TEXT = "#FFFFFF";
const SIDEBAR_BORDER = "rgba(255,255,255,0.08)";
const SIDEBAR_CARD_BG = "rgba(255,255,255,0.06)";

const CARD_PADDING = 6;
const CARD_RADIUS = 7;
const CARD_GAP = 6;
const NAME_FONT = 11;
const MSG_FONT = 10;
const CHIP_FONT = 11;

function formatBRL(n: number | null | undefined) {
    const v = typeof n === "number" ? n : 0;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    const pathname = usePathname();
    const adminOrdersCtx = useContext(AdminOrdersContext);
    const openOrder = adminOrdersCtx?.openOrder;
    const { companies, currentCompanyId, currentCompany, loading: loadingWorkspace, reload: reloadWorkspace } = useWorkspace();

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"orders" | "whatsapp">("orders");
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(false);
    const [openThread, setOpenThread] = useState<Thread | null>(null);
    const [collapsed, setCollapsed] = useState<boolean>(false);

    async function loadOrders() {
        if (!currentCompanyId) {
            setOrders([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const url = new URL("/api/orders/list", window.location.origin);
            url.searchParams.set("limit", "120");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setOrders([]);
                setLoading(false);
                return;
            }
            setOrders(normalizeOrders(json.orders));
        } catch (e) {
            console.error(e);
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
                    if (!res.ok) return;
                    await reloadWorkspace();
                    try { router.refresh(); } catch { }
                    await loadOrders();
                } catch (e) { console.warn(e); }
            })();
            return;
        }
        if (currentCompanyId) loadOrders();
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

    const newOrders = useMemo(() => orders.filter((o) => String(o.status) === "new"), [orders]);
    const newOrdersCount = newOrders.length;
    const newMessagesCount = threads.length;
    const latestNewOrders = useMemo(() => newOrders.slice(0, 6), [newOrders]);
    const latestThreads = useMemo(() => threads.slice().sort((a, b) => {
        const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return db - da;
    }).slice(0, 6), [threads]);

    const width = collapsed ? 64 : 240;

    // nav items using react-icons (Icon is the component)
    const navItems: { key: string; label: string; Icon: any; href: string }[] = [
        { key: "dashboard", label: "Dashboard", Icon: FiHome, href: "/" },
        { key: "whatsapp", label: "WhatsApp", Icon: FaWhatsapp, href: "/whatsapp" },
        { key: "cadastrar", label: "Cadastrar produto", Icon: AiOutlinePlusSquare, href: "/produtos" },
        { key: "produtos", label: "Produtos", Icon: GiCube, href: "/produtos/lista" },
        { key: "pedidos", label: "Pedidos", Icon: FiShoppingCart, href: "/pedidos" },
        { key: "relatorio", label: "Relatório", Icon: BiBarChart, href: "/relatorios" },
    ];

    function isNavActive(item: { key: string; href: string }) {
        if (!pathname) return false;
        if (item.key === "produtos") {
            return pathname === "/produtos/lista" || pathname.startsWith("/produtos/lista/");
        }
        if (item.key === "cadastrar") {
            if (pathname === "/produtos") return true;
            if (pathname.startsWith("/produtos/") && !pathname.startsWith("/produtos/lista")) return true;
            return false;
        }
        if (item.href === "/") return pathname === "/";
        return pathname === item.href || pathname.startsWith(item.href + "/");
    }

    return (
        <>
            <style>{`.renthus-sidebar { -ms-overflow-style: none; scrollbar-width: none; } .renthus-sidebar::-webkit-scrollbar { width: 0px; height: 0px; }`}</style>

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

                {/* menu */}
                <nav style={{ marginTop: 12 }}>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        {navItems.map((it) => {
                            const active = isNavActive(it);
                            const baseStyle: React.CSSProperties = {
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "none",
                                background: active ? "rgba(0,0,0,0.12)" : "transparent",
                                cursor: "pointer",
                                color: SIDEBAR_TEXT,
                            };

                            return (
                                <li key={it.key}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            try {
                                                router.push(it.href);
                                            } catch (e) {
                                                // fallback: recarregar a rota
                                                window.location.href = it.href;
                                            }
                                        }}
                                        style={baseStyle}
                                        aria-current={active ? "page" : undefined}
                                    >
                                        <it.Icon size={16} />
                                        {!collapsed && <span style={{ fontSize: 14, fontWeight: 700 }}>{it.label}</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                {!collapsed ? (
                    <>
                        <div style={{ marginTop: 12, borderTop: `1px solid ${SIDEBAR_BORDER}`, paddingTop: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => setTab("orders")} style={tab === "orders" ? chipOrangeStyle(true) : chipOrangeStyle(false)}>Pedidos ({newOrdersCount})</button>
                                <button onClick={() => setTab("whatsapp")} style={tab === "whatsapp" ? chipOrangeStyle(true) : chipOrangeStyle(false)}>WhatsApp ({newMessagesCount})</button>
                            </div>

                            <div style={{ marginTop: 10 }}>
                                {tab === "orders" ? (
                                    <>
                                        {loading ? <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)" }}>Carregando...</div> :
                                            newOrdersCount === 0 ? <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)" }}>Nenhum pedido novo.</div> :
                                                <div style={{ display: "grid", gap: CARD_GAP }}>
                                                    {latestNewOrders.map((o) => {
                                                        const name = o.customers?.name ?? "-";
                                                        return (
                                                            <button key={o.id} type="button" onClick={() => openOrder ? openOrder(o.id) : null} style={{
                                                                width: "100%", textAlign: "left", border: `1px solid ${SIDEBAR_BORDER}`, borderRadius: CARD_RADIUS,
                                                                padding: CARD_PADDING, cursor: "pointer", background: SIDEBAR_CARD_BG, boxSizing: "border-box", color: SIDEBAR_TEXT, display: "block"
                                                            }} title="Abrir pedido">
                                                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", minWidth: 0 }}>
                                                                    <div style={{ fontWeight: 900, fontSize: NAME_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{name}</div>
                                                                    <div style={{ fontWeight: 900, fontSize: 11 }}>
                                                                        <span style={{ borderRadius: 999, padding: "3px 6px", fontWeight: 900, color: statusColor(String(o.status)), border: `1px solid ${statusColor(String(o.status))}`, background: "rgba(255,255,255,0.02)", fontSize: 11 }}>{prettyStatus(String(o.status))}</span>
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                                                                    <span style={{ fontSize: MSG_FONT, fontWeight: 900 }}>R$ {formatBRL(o.total_amount)}</span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                        }
                                        <div style={{ marginTop: 8 }}>
                                            <button onClick={() => router.push("/pedidos")} style={{ ...btnBaseSlim(false), width: "100%", fontSize: CHIP_FONT }}>Abrir lista completa</button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {loadingThreads ? <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)" }}>Carregando...</div> :
                                            threads.length === 0 ? <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)" }}>Nenhuma conversa.</div> :
                                                <div style={{ display: "grid", gap: CARD_GAP }}>
                                                    {latestThreads.map((t) => (
                                                        <button key={t.id} type="button" onClick={() => setOpenThread(t)} style={{
                                                            width: "100%", textAlign: "left", border: `1px solid ${SIDEBAR_BORDER}`, borderRadius: CARD_RADIUS,
                                                            padding: CARD_PADDING, cursor: "pointer", background: SIDEBAR_CARD_BG, boxSizing: "border-box", color: SIDEBAR_TEXT, display: "block"
                                                        }}>
                                                            <div style={{ fontWeight: 900, fontSize: NAME_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.profile_name || t.phone_e164}</div>
                                                            <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>{t.phone_e164}</div>
                                                            <div style={{ fontSize: MSG_FONT, color: "rgba(255,255,255,0.8)", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.last_message_preview || "(sem mensagens)"}</div>
                                                        </button>
                                                    ))}
                                                </div>
                                        }
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                ) : null}
            </aside>
        </>
    );
}
