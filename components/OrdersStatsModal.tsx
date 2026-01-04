import React, { useEffect, useState } from "react";

type DailyRow = { date: string; revenue: number; orders: number };
type StatsResponse = {
    stats: { counts: Record<string, number>; totalRevenue: number };
    daily: DailyRow[];
};

export default function OrdersStatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<StatsResponse | null>(null);

    useEffect(() => {
        if (!open) return;
        let mounted = true;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch("/api/orders/stats", { credentials: "include" });
                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    throw new Error(txt || `Status ${res.status}`);
                }
                const json = await res.json();
                if (mounted) setData(json);
            } catch (e: any) {
                if (mounted) setError(e?.message ?? "Erro desconhecido");
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();
        return () => {
            mounted = false;
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                background: "rgba(0,0,0,0.45)",
            }}
        >
            <div style={{ width: 720, maxHeight: "85vh", overflowY: "auto", background: "#fff", borderRadius: 8, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <h3 style={{ margin: 0 }}>Estatísticas de Pedidos</h3>
                    <button onClick={onClose} style={{ cursor: "pointer" }}>
                        Fechar
                    </button>
                </div>

                {loading ? (
                    <div>Carregando...</div>
                ) : error ? (
                    <div style={{ color: "crimson" }}>Erro: {error}</div>
                ) : data ? (
                    <>
                        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                            <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
                                <div style={{ fontSize: 12, color: "#666" }}>Receita total</div>
                                <div style={{ fontWeight: 900, fontSize: 18 }}>R$ {Number(data.stats.totalRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                            </div>

                            <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
                                <div style={{ fontSize: 12, color: "#666" }}>Contagem por status</div>
                                <div style={{ marginTop: 6 }}>
                                    {Object.entries(data.stats.counts || {}).map(([k, v]) => (
                                        <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                                            <div style={{ textTransform: "capitalize" }}>{k}</div>
                                            <div style={{ fontWeight: 900 }}>{v}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: 10 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Evolução (últimos {data.daily.length} dias)</div>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #eee" }}>Data</th>
                                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #eee" }}>Pedidos</th>
                                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #eee" }}>Receita</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.daily.map((d) => (
                                        <tr key={d.date}>
                                            <td style={{ padding: 6, borderBottom: "1px solid #fafafa" }}>{d.date}</td>
                                            <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #fafafa" }}>{d.orders}</td>
                                            <td style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #fafafa" }}>
                                                R$ {Number(d.revenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <div>Nenhum dado disponível.</div>
                )}

                <div style={{ marginTop: 14, textAlign: "right" }}>
                    <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8 }}>
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
}
