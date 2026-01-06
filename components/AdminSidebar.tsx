"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminOrders } from "@/components/AdminOrdersContext";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import QuickReplyModal from "@/components/whatsapp/QuickReplyModal";
import OrdersStatsModal from "@/components/OrdersStatsModal";

// PossÃ­veis status de um pedido (order)
type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

type CustomerRow = { name: string; phone: string; address: string | null };

type OrderRow = {
    id: string;
    status: OrderStatus | string;
    total_amount: number;
    created_at: string;
    customers: CustomerRow | null;
};

// Modelo de uma conversa (thread) do WhatsApp.
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
 * - Ã s vezes `customers` vem como array (customers: [{...}])
 * - Ã s vezes vem como objeto (customers: {...})
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

// Modal simples para esse arquivo (perfil de empresa)
function ModalSimple({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
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
                zIndex: 80,
            }}
        >
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", background: "#fff", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{title}</h3>
                    <button onClick={onClose} style={{ borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}>
                        Fechar
                    </button>
                </div>
                <div style={{ marginTop: 12 }}>{children}</div>
            </div>
        </div>
    );
}

// FormulÃ¡rio de perfil (simples, integrado)
function CompanyProfileForm({ company, onChange, onLoad, onSave }: { company: any; onChange: (c: any) => void; onLoad: () => Promise<void>; onSave: () => Promise<void> }) {
    useEffect(() => {
        if (!company) {
            onLoad();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function updateField(key: string, value: any) {
        onChange({ ...(company ?? {}), [key]: value });
    }

    async function handleCepLookup() {
        const cep = String(company?.cep ?? "").replace(/\D/g, "");
        if (!cep) return alert("Informe o CEP");
        try {
            const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const json = await res.json();
            if (json.erro) return alert("CEP nÃ£o encontrado");
            updateField("street", json.logradouro || "");
            updateField("neighborhood", json.bairro || "");
            updateField("city", json.localidade || "");
            updateField("state", json.uf || "");
        } catch (e) {
            alert("Erro ao consultar CEP");
        }
    }

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <input value={company?.company_name ?? ""} onChange={(e) => updateField("company_name", e.target.value)} placeholder="RazÃ£o social" />
            <input value={company?.cnpj ?? ""} onChange={(e) => updateField("cnpj", e.target.value)} placeholder="CNPJ" />

            <div style={{ display: "flex", gap: 8 }}>
                <input value={company?.cep ?? ""} onChange={(e) => updateField("cep", e.target.value)} placeholder="CEP" />
                <button onClick={handleCepLookup} style={{ padding: "6px 10px", cursor: "pointer" }}>Preencher</button>
            </div>

            <input id="company-street" value={company?.street ?? ""} onChange={(e) => updateField("street", e.target.value)} placeholder="Rua" />
            <input value={company?.number ?? ""} onChange={(e) => updateField("number", e.target.value)} placeholder="NÃºmero (manual)" />
            <input value={company?.neighborhood ?? ""} onChange={(e) => updateField("neighborhood", e.target.value)} placeholder="Bairro" />
            <input value={company?.city ?? ""} onChange={(e) => updateField("city", e.target.value)} placeholder="Cidade" />
            <input value={company?.state ?? ""} onChange={(e) => updateField("state", e.target.value)} placeholder="Estado" />

            <input value={company?.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} placeholder="Telefone" />
            <input value={company?.email ?? ""} onChange={(e) => updateField("email", e.target.value)} placeholder="Email" />
            <input value={company?.responsible ?? ""} onChange={(e) => updateField("responsible", e.target.value)} placeholder="ResponsÃ¡vel" />

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={onSave} style={{ background: "#3B246B", color: "#fff", padding: "8px 12px", borderRadius: 10 }}>Salvar</button>
                <button onClick={() => { /* fechar Ã© responsabilidade do pai */ }} style={{ padding: "8px 12px", borderRadius: 10 }}>Cancelar</button>
            </div>
        </div>
    );
}

export default function AdminSidebar() {
    const router = useRouter();
    const sp = useSearchParams();
    const { openOrder } = useAdminOrders();
    const [selected, setSelected] = useState<OrderStatus | null>((sp.get("status") as OrderStatus | null) ?? null);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<string | null>(null);
    const [tab, setTab] = useState<"orders" | "whatsapp">("orders");
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(false);
    const [threadsMsg, setThreadsMsg] = useState<string | null>(null);
    const [openThread, setOpenThread] = useState<Thread | null>(null);
    const [showStats, setShowStats] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [companyProfile, setCompanyProfile] = useState<any>(null);
    const [profileMsg, setProfileMsg] = useState<string | null>(null);

    async function loadOrders() {
        setLoading(true);
        setMsg(null);
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
        setLoading(false);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {/* Workspace: Ã­cones + nome da empresa */}
            <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <WorkspaceSwitcher />
                <div style={{ fontWeight: 900 }}>Disk Bebidas</div>
            </div>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, marginBottom: 10 }}>
                {/* BotÃµes principais */}
                <Link href="/whatsapp" style={{ textDecoration: "none" }}>
                    <button style={{ width: "100%", marginTop: 8 }}>
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
            </div>

            {/* Cards */}
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>Pedidos</div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setShowStats(true)} style={{ ...btnPurpleOutline(false), padding: "6px 8px", fontSize: 11 }}>
                            EstatÃ­sticas
                        </button>
                        <button onClick={() => goStatus("all")} style={{ ...btnOrangeOutline(false), padding: "6px 8px", fontSize: 11 }}>
                            Ver todos ({stats.total})
                        </button>
                    </div>
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
                    </>
                )}
            </div>

            {/* Perfil e Sair */}
            <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 12 }}>
                <button onClick={() => setProfileOpen(true)} style={{ ...btnPurpleOutline(false), width: "100%", marginBottom: 8 }}>
                    Editar perfil da empresa
                </button>
                <button
                    onClick={async () => {
                        try {
                            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                        } catch (e) {
                            // ignore
                        }
                        router.push("/login");
                    }}
                    style={{ ...btnOrangeOutline(false), width: "100%" }}
                >
                    Sair
                </button>
            </div>

            {openThread ? <QuickReplyModal thread={openThread} onClose={() => setOpenThread(null)} /> : null}
            {showStats ? <OrdersStatsModal open={showStats} onClose={() => setShowStats(false)} /> : null}

            {profileOpen ? (
                <ModalSimple
                    title="Editar perfil da empresa"
                    open={profileOpen}
                    onClose={() => {
                        setProfileOpen(false);
                        setProfileMsg(null);
                    }}
                >
                    <CompanyProfileForm
                        company={companyProfile}
                        onChange={(next: any) => setCompanyProfile(next)}
                        onLoad={async () => {
                            try {
                                const res = await fetch("/api/company/me", { credentials: "include" });
                                if (res.ok) {
                                    const json = await res.json();
                                    setCompanyProfile(json.company ?? json);
                                }
                            } catch (e) {
                                // ignore
                            }
                        }}
                        onSave={async () => {
                            setProfileMsg(null);
                            try {
                                const res = await fetch("/api/company/update", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    credentials: "include",
                                    body: JSON.stringify(companyProfile ?? {}),
                                });
                                const json = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                    setProfileMsg(json?.error ?? "Erro ao salvar perfil");
                                    return;
                                }
                                setProfileMsg("âœ… Salvo");
                                setTimeout(() => {
                                    setProfileOpen(false);
                                }, 800);
                            } catch (e) {
                                setProfileMsg("Erro ao salvar perfil");
                            }
                        }}
                    />
                    {profileMsg ? <div style={{ marginTop: 8, color: profileMsg.startsWith("âœ…") ? "#0DAA00" : "crimson" }}>{profileMsg}</div> : null}
                </ModalSimple>
            ) : null}
        </aside>
    );
}
