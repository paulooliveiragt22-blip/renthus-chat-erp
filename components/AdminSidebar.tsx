// components/AdminSidebar.tsx
"use client";

import React, { useEffect, useMemo, useState, useContext } from "react";
import Link from "next/link";
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

    const navItems: { key: string; label: string; Icon: any; href: string }[] = [
        { key: "dashboard", label: "Dashboard", Icon: FiHome, href: "/" },
        { key: "whatsapp", label: "WhatsApp", Icon: FaWhatsapp, href: "/whatsapp" },
        { key: "cadastrar", label: "Cadastrar produto", Icon: AiOutlinePlusSquare, href: "/produtos" },
        { key: "produtos", label: "Produtos", Icon: GiCube, href: "/produtos/lista" },
        { key: "pedidos", label: "Pedidos", Icon: FiShoppingCart, href: "/pedidos" },
        { key: "relatorio", label: "Relatórios", Icon: BiBarChart, href: "/relatorios" },
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

                <nav style={{ marginTop: 12 }}>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        {navItems.map((it) => {
                            const active = isNavActive(it);
                            return (
                                <li key={it.key}>
                                    <Link
                                        href={it.href}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 12,
                                            width: "100%",
                                            textDecoration: "none",
                                            padding: "10px 12px",
                                            borderRadius: 8,
                                            color: SIDEBAR_TEXT,
                                            background: active ? SIDEBAR_CARD_BG : "transparent",
                                            fontWeight: active ? 800 : 600,
                                        }}
                                    >
                                        <it.Icon size={18} />
                                        {!collapsed ? <span style={{ fontSize: 14 }}>{it.label}</span> : null}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <button onClick={() => setTab("orders")} style={{ padding: 6, borderRadius: 8, ...(tab === "orders" ? { background: SIDEBAR_CARD_BG } : {}) }}>
                            Pedidos ({newOrdersCount})
                        </button>
                        <button onClick={() => setTab("whatsapp")} style={{ padding: 6, borderRadius: 8, ...(tab === "whatsapp" ? { background: SIDEBAR_CARD_BG } : {}) }}>
                            WhatsApp ({newMessagesCount})
                        </button>
                    </div>

                    {tab === "orders" ? (
                        <div>
                            {loading ? <div>Carregando...</div> : null}
                            {latestNewOrders.map((o) => (
                                <div key={o.id} style={{ padding: 8, borderRadius: 8, background: SIDEBAR_CARD_BG, marginBottom: 6 }}>
                                    <div style={{ fontWeight: 800 }}>{o.customers?.name ?? "Cliente"}</div>
                                    <div style={{ color: "#ddd", fontSize: 12 }}>{prettyStatus(o.status)}</div>
                                    <div style={{ color: "#fff", fontSize: 12 }}>{formatBRL(o.total_amount)}</div>
                                </div>
                            ))}
                            <div style={{ marginTop: 8 }}>
                                <Link href="/pedidos" style={{ color: "#fff", textDecoration: "underline" }}>Ver todos os pedidos</Link>
                            </div>
                        </div>
                    ) : (
                        <div>
                            {loadingThreads ? <div>Carregando...</div> : null}
                            {latestThreads.map((t) => (
                                <div
                                    key={t.id}
                                    onClick={() => setOpenThread(t)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === "Enter") setOpenThread(t); }}
                                    style={{
                                        padding: 8,
                                        borderRadius: 8,
                                        background: SIDEBAR_CARD_BG,
                                        marginBottom: 6,
                                        cursor: "pointer",
                                    }}
                                >
                                    <div style={{ fontWeight: 700 }}>{t.profile_name ?? t.phone_e164}</div>
                                    <div style={{ color: "#ddd", fontSize: 12 }}>{t.last_message_preview ?? ""}</div>
                                </div>
                            ))}
                            <div style={{ marginTop: 8 }}>
                                <Link href="/whatsapp" style={{ color: "#fff", textDecoration: "underline" }}>Ir ao WhatsApp</Link>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ marginTop: 14 }}>
                    <OrdersStatsModal />
                </div>
            </aside>

            {/* Renderiza o modal somente quando há um thread selecionado */}
            {openThread ? (
                <QuickReplyModal
                    thread={openThread}
                    onClose={() => setOpenThread(null)}
                />
            ) : null}
        </>
    );
}
