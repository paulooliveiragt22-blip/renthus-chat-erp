// app/(admin)/relatorios/page.tsx  (trecho principal atualizado)
"use client";

import React, { useEffect, useMemo, useState } from "react";

function formatBRL(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function todayIsoDate() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}
function isoDateNDaysAgo(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}

export default function RelatoriosPage() {
    const [start, setStart] = useState<string>(isoDateNDaysAgo(30));
    const [end, setEnd] = useState<string>(todayIsoDate());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{ faturamento: number; total_orders: number; total_messages: number } | null>(null);
    const [daily, setDaily] = useState<{ date: string; faturamento: number; orders: number; messages: number }[] | null>(null);

    const fetchSummary = async (s?: string, e?: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/reports/summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ start: s ?? start, end: e ?? end }),
                credentials: "same-origin",
            });
            const j = await res.json();
            if (!res.ok) {
                setError(j?.error ?? "Erro ao carregar relatório");
                setData(null);
            } else if (!j?.ok) {
                setError(j?.error ?? "Resposta inesperada");
                setData(null);
            } else {
                setData(j.data);
            }
        } catch (err: any) {
            setError(err?.message ?? "Falha na requisição");
            setData(null);
        } finally {
            setLoading(false);
        }
    };

    const fetchDaily = async (s?: string, e?: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/reports/daily", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ start: s ?? start, end: e ?? end }),
                credentials: "same-origin",
            });
            const j = await res.json();
            if (!res.ok) {
                setError(j?.error ?? "Erro ao carregar daily");
                setDaily(null);
            } else if (!j?.ok) {
                setError(j?.error ?? "Resposta inesperada daily");
                setDaily(null);
            } else {
                setDaily(j.data);
            }
        } catch (err: any) {
            setError(err?.message ?? "Falha na requisição daily");
            setDaily(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // carregamento inicial: summary + daily
        fetchSummary();
        fetchDaily();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const disabledApply = useMemo(() => {
        const ds = new Date(start);
        const de = new Date(end);
        return isNaN(ds.getTime()) || isNaN(de.getTime()) || ds.getTime() > de.getTime();
    }, [start, end]);

    const applyFilter = () => {
        fetchSummary(start, end);
        fetchDaily(start, end);
    };

    return (
        <div style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Relatórios</h1>
                    <p style={{ marginTop: 6, color: "#666" }}>Faturamento, total de pedidos e total de mensagens — filtre por período.</p>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ fontSize: 12, color: "#555" }}>De</label>
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />

                    <label style={{ fontSize: 12, color: "#555" }}>Até</label>
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />

                    <button
                        onClick={applyFilter}
                        disabled={disabledApply || loading}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            background: "#3B246B",
                            color: "#fff",
                            border: "none",
                            cursor: disabledApply || loading ? "not-allowed" : "pointer",
                        }}
                        title={disabledApply ? "Datas inválidas" : "Aplicar filtro"}
                    >
                        {loading ? "Carregando..." : "Aplicar"}
                    </button>
                </div>
            </div>

            <div style={{ marginTop: 18 }}>
                {error ? (
                    <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,0,0,0.06)", color: "crimson" }}>{error}</div>
                ) : null}

                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Faturamento</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>
                            {data ? formatBRL(data.faturamento) : "—"}
                        </div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Período: {start} → {end}</div>
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Total de pedidos</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>
                            {data ? data.total_orders : "—"}
                        </div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Pedidos criados no período</div>
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Total de mensagens</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>
                            {data ? data.total_messages : "—"}
                        </div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Mensagens Whatsapp no período</div>
                    </div>
                </div>

                {/* Dados diários */}
                <div style={{ marginTop: 18 }}>
                    <h2 style={{ fontSize: 16, marginBottom: 8 }}>Dados diários</h2>

                    {daily === null ? (
                        <div style={{ color: "#666" }}>Sem dados</div>
                    ) : (
                        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                                <thead>
                                    <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                                        <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Data</th>
                                        <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Faturamento</th>
                                        <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Pedidos</th>
                                        <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Mensagens</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daily.map((d) => (
                                        <tr key={d.date} style={{ borderBottom: "1px solid #fafafa" }}>
                                            <td style={{ padding: 10 }}>{d.date}</td>
                                            <td style={{ padding: 10 }}>{formatBRL(d.faturamento)}</td>
                                            <td style={{ padding: 10 }}>{d.orders}</td>
                                            <td style={{ padding: 10 }}>{d.messages}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
