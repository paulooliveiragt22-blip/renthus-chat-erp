// app/(admin)/impressoras/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

const PURPLE = "#3B246B";

function btn(extra: React.CSSProperties = {}): React.CSSProperties {
    return { padding: "8px 14px", borderRadius: 8, border: "none", background: PURPLE, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, ...extra };
}

type AgentRow = { id: string; name: string; api_key_prefix: string; is_active: boolean; last_seen: string | null; created_at: string };
type PrintedOrder = { id: string; customer_name: string | null; total_amount: number; printed_at: string; status: string };

export default function ImpressorasPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId } = useWorkspace();

    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [generatingKey, setGeneratingKey] = useState(false);
    const [newApiKey, setNewApiKey] = useState<string | null>(null);
    const [agentError, setAgentError] = useState<string | null>(null);

    const [printedOrders, setPrintedOrders] = useState<PrintedOrder[]>([]);
    const [loadingPrinted, setLoadingPrinted] = useState(true);

    const [testMsg, setTestMsg] = useState<string | null>(null);
    const [testLoading, setTestLoading] = useState(false);

    useEffect(() => {
        if (!currentCompanyId) return;
        loadAgents();
        loadPrintedOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCompanyId]);

    async function loadAgents() {
        try {
            const res = await fetch("/api/agent/keys");
            if (res.ok) setAgents((await res.json()).agents ?? []);
        } catch (_) {}
    }

    async function generateAgentKey() {
        setGeneratingKey(true);
        setNewApiKey(null);
        setAgentError(null);
        try {
            const res = await fetch("/api/agent/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) { setAgentError("Erro ao gerar chave: " + (json?.error ?? res.statusText)); return; }
            setNewApiKey(json.api_key);
            loadAgents();
        } catch (e: any) {
            setAgentError("Erro de rede: " + e.message);
        } finally {
            setGeneratingKey(false);
        }
    }

    async function revokeAgent(agentId: string) {
        if (!confirm("Desativar este agente? A chave deixará de funcionar.")) return;
        const res = await fetch("/api/agent/keys", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_id: agentId }),
        });
        if (res.ok) loadAgents();
    }

    async function loadPrintedOrders() {
        if (!currentCompanyId) return;
        setLoadingPrinted(true);
        try {
            const { data } = await supabase
                .from("orders")
                .select("id, customer_name, total_amount, printed_at, status")
                .eq("company_id", currentCompanyId)
                .not("printed_at", "is", null)
                .order("printed_at", { ascending: false })
                .limit(30);
            setPrintedOrders((data as PrintedOrder[]) ?? []);
        } catch (_) {}
        finally { setLoadingPrinted(false); }
    }

    async function testPrint() {
        if (!currentCompanyId) return;
        setTestLoading(true);
        setTestMsg(null);
        try {
            const { data: ord, error: ordErr } = await supabase
                .from("orders")
                .insert([{
                    company_id: currentCompanyId,
                    channel: "admin",
                    customer_name: "Teste Impressão",
                    customer_phone: "000000000",
                    total_amount: 0,
                    status: "new",
                }])
                .select("id")
                .single();
            if (ordErr) { setTestMsg("Erro: " + ordErr.message); return; }
            await supabase.from("order_items").insert([{
                order_id: ord.id,
                company_id: currentCompanyId,
                product_name: "Teste Cupom",
                quantity: 1,
                unit_price: 0,
            }]);
            setTestMsg("Pedido de teste criado — o agente deve imprimir automaticamente.");
            setTimeout(() => loadPrintedOrders(), 4000);
        } catch (e: any) {
            setTestMsg("Erro: " + e.message);
        } finally {
            setTestLoading(false);
        }
    }

    const card: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 20 };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Impressão</h1>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* ── Agente de impressão ── */}
                <div style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 15 }}>Agente de impressão</div>
                            <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
                                Gere uma chave e insira no Renthus Print Agent instalado no PC da impressora.
                            </div>
                        </div>
                        <button onClick={generateAgentKey} disabled={generatingKey} style={btn({ background: "#5a2d82" })}>
                            {generatingKey ? "Gerando..." : "+ Nova chave"}
                        </button>
                    </div>

                    {agentError && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 10, marginBottom: 12, color: "#991b1b", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                            {agentError}
                            <button onClick={() => setAgentError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b", fontWeight: 700 }}>✕</button>
                        </div>
                    )}

                    {newApiKey && (
                        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: 12, marginBottom: 14 }}>
                            <div style={{ fontWeight: 700, color: "#166534", marginBottom: 6, fontSize: 13 }}>
                                ✓ Copie agora — não será exibida novamente:
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <code style={{ background: "#dcfce7", padding: "6px 10px", borderRadius: 4, fontSize: 12, flex: 1, wordBreak: "break-all", fontFamily: "monospace" }}>
                                    {newApiKey}
                                </code>
                                <button onClick={() => navigator.clipboard.writeText(newApiKey)} style={btn({ background: "#166534", padding: "6px 10px", fontSize: 12 })}>Copiar</button>
                                <button onClick={() => setNewApiKey(null)} style={btn({ background: "#666", padding: "6px 10px", fontSize: 12 })}>OK</button>
                            </div>
                            <div style={{ marginTop: 8, color: "#555", fontSize: 11 }}>
                                URL: <strong>{typeof window !== "undefined" ? window.location.origin : ""}</strong>
                            </div>
                        </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {agents.length === 0
                            ? <div style={{ color: "#aaa", fontSize: 13 }}>Nenhum agente configurado.</div>
                            : agents.map(a => (
                                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                                    <div>
                                        <span style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</span>
                                        <span style={{ marginLeft: 8, fontSize: 12, color: a.is_active ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                            {a.is_active ? "● Ativo" : "● Inativo"}
                                        </span>
                                        <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>rpa_{a.api_key_prefix}…</div>
                                        {a.last_seen && (
                                            <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>
                                                Último acesso: {new Date(a.last_seen).toLocaleString("pt-BR")}
                                            </div>
                                        )}
                                    </div>
                                    {a.is_active && (
                                        <button onClick={() => revokeAgent(a.id)} style={btn({ background: "#dc2626", fontSize: 11, padding: "4px 10px" })}>
                                            Revogar
                                        </button>
                                    )}
                                </div>
                            ))
                        }
                    </div>

                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f0f0f0" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button onClick={testPrint} disabled={testLoading} style={btn({ background: "#2e7d32" })}>
                                {testLoading ? "Criando..." : "Criar pedido de teste"}
                            </button>
                        </div>
                        {testMsg && <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>{testMsg}</div>}
                    </div>
                </div>

                {/* ── Pedidos impressos ── */}
                <div style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>Impressos pelo agente</div>
                        <button onClick={loadPrintedOrders} style={btn({ background: "#666", padding: "6px 10px", fontSize: 12 })}>↻ Atualizar</button>
                    </div>
                    <div style={{ maxHeight: 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                        {loadingPrinted
                            ? <div style={{ color: "#aaa", fontSize: 13 }}>Carregando...</div>
                            : printedOrders.length === 0
                                ? <div style={{ color: "#aaa", fontSize: 13 }}>Nenhum pedido impresso ainda.</div>
                                : printedOrders.map(o => (
                                    <div key={o.id} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #eee", background: "#fafafa" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div style={{ fontWeight: 700, fontSize: 13 }}>{o.customer_name || "—"}</div>
                                            <div style={{ fontWeight: 800, color: PURPLE, fontSize: 13 }}>
                                                R$ {Number(o.total_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                        <div style={{ color: "#aaa", fontSize: 11, marginTop: 3 }}>
                                            {new Date(o.printed_at).toLocaleString("pt-BR")} · {o.id.slice(0, 8).toUpperCase()}
                                        </div>
                                    </div>
                                ))
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}
