// app/(admin)/relatorios/page.tsx
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
function dateDiffDays(startIso: string, endIso: string) {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const ms = 24 * 60 * 60 * 1000;
    return Math.floor((e.getTime() - s.getTime()) / ms) + 1;
}

export default function RelatoriosPage() {
    const [start, setStart] = useState<string>(isoDateNDaysAgo(30));
    const [end, setEnd] = useState<string>(todayIsoDate());

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // summary = agregados do período
    const [summary, setSummary] = useState<{ faturamento: number; total_orders: number; total_messages: number } | null>(null);
    // daily = somente dias COM lançamentos (o endpoint retorna isso)
    const [daily, setDaily] = useState<{ date: string; faturamento: number; orders: number; messages: number }[] | null>(null);

    // filtros visuais e por mínimos
    const [showFaturamento, setShowFaturamento] = useState(true);
    const [showPedidos, setShowPedidos] = useState(true);
    const [showMensagens, setShowMensagens] = useState(true);
    const [minFaturamento, setMinFaturamento] = useState<number>(0);
    const [minPedidos, setMinPedidos] = useState<number>(0);
    const [minMensagens, setMinMensagens] = useState<number>(0);

    // -------------------------
    // Summary (agregados)
    // -------------------------
    const fetchSummary = async (s?: string, e?: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/reports/summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ start: s ?? start, end: e ?? end }),
            });
            const j = await res.json();
            if (!res.ok) {
                setError(j?.error ?? "Erro ao carregar relatório");
                setSummary(null);
            } else if (!j?.ok) {
                setError(j?.error ?? "Resposta inesperada");
                setSummary(null);
            } else {
                // garantir que é o summary (objeto)
                setSummary(j.data ?? null);
            }
        } catch (err: any) {
            setError(err?.message ?? "Falha na requisição");
            setSummary(null);
        } finally {
            setLoading(false);
        }
    };

    // -------------------------
    // Daily (dias que têm lançamentos)
    // -------------------------
    const fetchDaily = async (s?: string, e?: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/reports/daily", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ start: s ?? start, end: e ?? end }),
            });
            const j = await res.json();
            if (!res.ok) {
                setError(j?.error ?? "Erro ao carregar daily");
                setDaily(null);
            } else if (!j?.ok) {
                setError(j?.error ?? "Resposta inesperada daily");
                setDaily(null);
            } else {
                // o endpoint foi ajustado para retornar APENAS dias com lançamentos
                setDaily(Array.isArray(j.data) ? j.data : []);
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

    // aplica filtros por mínimos (mantemos apenas dias com lançamentos e >= mínimos)
    const filteredDaily = useMemo(() => {
        const arr = daily ?? [];
        return arr.filter((d) => {
            if ((d.faturamento || 0) < (minFaturamento || 0)) return false;
            if ((d.orders || 0) < (minPedidos || 0)) return false;
            if ((d.messages || 0) < (minMensagens || 0)) return false;
            return true;
        });
    }, [daily, minFaturamento, minPedidos, minMensagens]);

    // -------------------------
    // Export CSV
    // -------------------------
    const exportCSV = () => {
        try {
            if (!filteredDaily || filteredDaily.length === 0) {
                alert("Nenhum lançamento para exportar no período com os filtros atuais.");
                return;
            }

            const cols = ["Data"];
            if (showFaturamento) cols.push("Faturamento");
            if (showPedidos) cols.push("Pedidos");
            if (showMensagens) cols.push("Mensagens");

            const rows = filteredDaily.map((r) => {
                const row: string[] = [r.date];
                if (showFaturamento) row.push((r.faturamento ?? 0).toFixed(2));
                if (showPedidos) row.push(String(r.orders ?? 0));
                if (showMensagens) row.push(String(r.messages ?? 0));
                return row.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",");
            });

            const csv = [cols.join(","), ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `relatorio_${start}_${end}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error("exportCSV error", err);
            alert("Erro ao exportar CSV: " + (err?.message ?? String(err)));
        }
    };

    // -------------------------
    // Export PDF (dynamic import, try/catch)
    // -------------------------
    const exportPDF = async () => {
        try {
            const days = dateDiffDays(start, end);
            if (days > 90) {
                alert("Exportação em PDF limitada a 90 dias. Escolha um período menor ou exporte em CSV.");
                return;
            }

            if (!filteredDaily || filteredDaily.length === 0) {
                alert("Nenhum lançamento para exportar no período com os filtros atuais.");
                return;
            }

            // dynamic import para evitar problemas com bundler/SSR e garantir plugin anexado
            const jsPDFModule = await import("jspdf");
            // alguns bundlers exportam o jsPDF como default e outros como named; tratar ambos
            const jsPDF = (jsPDFModule && (jsPDFModule.jsPDF || jsPDFModule.default || jsPDFModule)) as any;
            // importa plugin autotable — o plugin registra autoTable no prototype do jsPDF quando importado
            await import("jspdf-autotable");

            const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

            const head: string[] = ["Data"];
            if (showFaturamento) head.push("Faturamento");
            if (showPedidos) head.push("Pedidos");
            if (showMensagens) head.push("Mensagens");

            const body = filteredDaily.map((r) => {
                const row: string[] = [r.date];
                if (showFaturamento) row.push(formatBRL(r.faturamento ?? 0));
                if (showPedidos) row.push(String(r.orders ?? 0));
                if (showMensagens) row.push(String(r.messages ?? 0));
                return row;
            });

            doc.setFontSize(14);
            doc.text(`Relatório diário: ${start} → ${end}`, 40, 40);

            // @ts-ignore safe: autoTable is provided by jspdf-autotable import
            doc.autoTable({
                head: [head],
                body,
                startY: 60,
                styles: { fontSize: 10 },
                headStyles: { fillColor: [59, 36, 107] },
                theme: "grid",
            });

            doc.save(`relatorio_${start}_${end}.pdf`);
        } catch (err: any) {
            // IMPORTANT: capturamos o erro para evitar o overlay do Next (TypeError etc.)
            console.error("exportPDF error", err);
            alert("Erro ao gerar PDF: " + (err?.message ?? String(err)) + ". Verifique se instalou 'jspdf' e 'jspdf-autotable' e reinicie o dev server.");
        }
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
                {error ? <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,0,0,0.06)", color: "crimson" }}>{error}</div> : null}

                {/* CARDS */}
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Faturamento</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>
                            {summary ? formatBRL(summary.faturamento) : "—"}
                        </div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Período: {start} → {end}</div>
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Total de pedidos</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>{summary ? summary.total_orders : "—"}</div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Pedidos criados no período</div>
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
                        <div style={{ fontSize: 12, color: "#666" }}>Total de mensagens</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900 }}>{summary ? summary.total_messages : "—"}</div>
                        <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>Mensagens Whatsapp no período</div>
                    </div>
                </div>

                {/* filtros e exports */}
                <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ fontSize: 13 }}>
                            <input type="checkbox" checked={showFaturamento} onChange={() => setShowFaturamento((v) => !v)} /> Faturamento
                        </label>
                        <label style={{ fontSize: 13 }}>
                            <input type="checkbox" checked={showPedidos} onChange={() => setShowPedidos((v) => !v)} /> Pedidos
                        </label>
                        <label style={{ fontSize: 13 }}>
                            <input type="checkbox" checked={showMensagens} onChange={() => setShowMensagens((v) => !v)} /> Mensagens
                        </label>

                        <label style={{ fontSize: 13, marginLeft: 10 }}>
                            Mín. Faturamento:
                            <input type="number" min={0} value={minFaturamento} onChange={(e) => setMinFaturamento(Number(e.target.value) || 0)} style={{ width: 120 }} />
                        </label>
                        <label style={{ fontSize: 13 }}>Mín. Pedidos:
                            <input type="number" min={0} value={minPedidos} onChange={(e) => setMinPedidos(Number(e.target.value) || 0)} style={{ width: 80 }} />
                        </label>
                        <label style={{ fontSize: 13 }}>Mín. Mensagens:
                            <input type="number" min={0} value={minMensagens} onChange={(e) => setMinMensagens(Number(e.target.value) || 0)} style={{ width: 80 }} />
                        </label>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={exportCSV} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}>
                            Exportar CSV
                        </button>
                        <button onClick={exportPDF} style={{ padding: "8px 12px", borderRadius: 8, background: "#3B246B", color: "#fff", border: "none" }}>
                            Exportar PDF (até 90 dias)
                        </button>
                    </div>
                </div>

                {/* tabela */}
                <div style={{ marginTop: 18 }}>
                    <h2 style={{ fontSize: 16, marginBottom: 8 }}>Dados diários</h2>

                    {filteredDaily.length === 0 ? (
                        <div style={{ color: "#666" }}>Nenhum lançamento encontrado no período com os filtros aplicados.</div>
                    ) : (
                        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                                <thead>
                                    <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                                        <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Data</th>
                                        {showFaturamento && <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Faturamento</th>}
                                        {showPedidos && <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Pedidos</th>}
                                        {showMensagens && <th style={{ padding: 10, fontSize: 12, color: "#666" }}>Mensagens</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDaily.map((d) => (
                                        <tr key={d.date} style={{ borderBottom: "1px solid #fafafa" }}>
                                            <td style={{ padding: 10 }}>{d.date}</td>
                                            {showFaturamento && <td style={{ padding: 10 }}>{formatBRL(d.faturamento ?? 0)}</td>}
                                            {showPedidos && <td style={{ padding: 10 }}>{d.orders ?? 0}</td>}
                                            {showMensagens && <td style={{ padding: 10 }}>{d.messages ?? 0}</td>}
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
