"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AdminOrdersContext } from "@/components/AdminOrdersContext";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";
const CARD_BG = "#fff";
const BORDER = "#eee";

type OrderStatus = "new" | "canceled" | "delivered" | "finalized";
type OrderRow = { id: string; status: string; total_amount: number; created_at: string; customer_name?: string | null; customers?: { name?: string } | null };
type Thread = { id: string; phone_e164: string; profile_name: string | null; last_message_at: string | null; last_message_preview: string | null };

function prettyStatus(s: string) {
    if (s === "new") return "Novo";
    if (s === "canceled") return "Cancelado";
    if (s === "delivered") return "Entregue";
    if (s === "finalized") return "Finalizado";
    return s;
}
function statusColor(s: string) {
    if (s === "new") return "#16a34a";
    if (s === "canceled") return "crimson";
    if (s === "finalized") return "dodgerblue";
    if (s === "delivered") return "#888";
    return "#333";
}
function fmtBRL(n?: number) {
    return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export default function DashboardPage() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId } = useWorkspace();
    const adminOrdersCtx = useContext(AdminOrdersContext);

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(true);
    const [openThread, setOpenThread] = useState<Thread | null>(null);

    async function loadOrders(showSpinner = false) {
        if (showSpinner) setLoadingOrders(true);
        try {
            const res = await fetch("/api/orders/list?limit=20", { credentials: "include" });
            const json = await res.json().catch(() => ({}));
            const raw: any[] = Array.isArray(json.orders) ? json.orders : [];
            setOrders(raw.map(o => ({
                id: String(o.id),
                status: String(o.status ?? ""),
                total_amount: Number(o.total_amount ?? 0),
                created_at: String(o.created_at ?? ""),
                customer_name: o.customers?.name ?? o.customer_name ?? null,
            })));
        } catch { }
        finally { if (showSpinner) setLoadingOrders(false); }
    }

    async function loadThreads(showSpinner = false) {
        if (showSpinner) setLoadingThreads(true);
        try {
            const res = await fetch("/api/whatsapp/threads?limit=20", { credentials: "include" });
            const json = await res.json().catch(() => ({}));
            setThreads(Array.isArray(json.threads) ? json.threads : []);
        } catch { }
        finally { if (showSpinner) setLoadingThreads(false); }
    }

    useEffect(() => {
        loadOrders(true);
        loadThreads(true);

        const id = window.setInterval(() => {
            loadOrders(false);
            loadThreads(false);
        }, 15000);
        return () => clearInterval(id);
    }, [currentCompanyId]);

    const newOrders = orders.filter(o => o.status === "new");

    const sectionStyle: React.CSSProperties = {
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 16,
        flex: 1,
        minWidth: 0,
    };

    const headerStyle: React.CSSProperties = {
        fontWeight: 800,
        fontSize: 15,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Resumo rápido */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ ...sectionStyle, flex: "0 0 auto", minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>Pedidos novos</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: ORANGE, marginTop: 4 }}>{newOrders.length}</div>
                </div>
                <div style={{ ...sectionStyle, flex: "0 0 auto", minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>Conversas WhatsApp</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: PURPLE, marginTop: 4 }}>{threads.length}</div>
                </div>
            </div>

            {/* Pedidos + WhatsApp lado a lado */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                {/* Pedidos novos */}
                <div style={sectionStyle}>
                    <div style={headerStyle}>
                        <span>Pedidos novos</span>
                        <button
                            onClick={() => router.push("/pedidos")}
                            style={{ fontSize: 12, color: ORANGE, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
                        >
                            Ver todos →
                        </button>
                    </div>
                    {loadingOrders ? (
                        <div style={{ fontSize: 13, color: "#aaa" }}>Carregando...</div>
                    ) : newOrders.length === 0 ? (
                        <div style={{ fontSize: 13, color: "#aaa" }}>Nenhum pedido novo.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {newOrders.map(o => (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => adminOrdersCtx?.openOrder?.(o.id)}
                                    style={{
                                        display: "flex", justifyContent: "space-between", alignItems: "center",
                                        padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`,
                                        background: "#fafafa", cursor: "pointer", textAlign: "left", width: "100%",
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>{o.customer_name || "—"}</div>
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                            {new Date(o.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontWeight: 800, fontSize: 13 }}>R$ {fmtBRL(o.total_amount)}</div>
                                        <div style={{ fontSize: 11, color: statusColor(o.status), fontWeight: 700, marginTop: 2 }}>
                                            {prettyStatus(o.status)}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* WhatsApp */}
                <div style={sectionStyle}>
                    <div style={headerStyle}>
                        <span>WhatsApp</span>
                        <button
                            onClick={() => router.push("/whatsapp")}
                            style={{ fontSize: 12, color: "#25D366", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
                        >
                            Ver todos →
                        </button>
                    </div>
                    {loadingThreads ? (
                        <div style={{ fontSize: 13, color: "#aaa" }}>Carregando...</div>
                    ) : threads.length === 0 ? (
                        <div style={{ fontSize: 13, color: "#aaa" }}>Nenhuma conversa.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {threads.map(t => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setOpenThread(t)}
                                    style={{
                                        display: "flex", flexDirection: "column", gap: 2,
                                        padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`,
                                        background: "#fafafa", cursor: "pointer", textAlign: "left", width: "100%",
                                    }}
                                >
                                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.profile_name || t.phone_e164}</div>
                                    <div style={{ fontSize: 11, color: "#888" }}>{t.phone_e164}</div>
                                    {t.last_message_preview && (
                                        <div style={{ fontSize: 11, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                            {t.last_message_preview}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {openThread && (
                <QuickReplyModal thread={openThread} onClose={() => setOpenThread(null)} />
            )}
        </div>
    );
}
