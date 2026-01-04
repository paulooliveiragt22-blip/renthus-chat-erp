"use client";

import React, { useEffect, useMemo, useState } from "react";

type ActiveSubscription = {
    subscription_id: string;
    plan_id: string;
    plan_key: string;
    plan_name: string | null;
    allow_overage: boolean;
} | null;

type LimitCheckResult = {
    allowed: boolean;
    feature_key: string;
    year_month: string;
    used: number;
    limit_per_month: number | null;
    will_overage_by: number;
    allow_overage: boolean;
};

type StatusResponse = {
    ok: true;
    company_id: string;
    subscription: ActiveSubscription;
    enabled_features: string[];
    enabled_features_count: number;
    usage: {
        whatsapp_messages: LimitCheckResult;
    };
};

function Badge({ children }: { children: React.ReactNode }) {
    return (
        <span
            style={{
                display: "inline-block",
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e5e5",
                background: "#fafafa",
                fontSize: 12,
                fontWeight: 800,
            }}
        >
            {children}
        </span>
    );
}

export default function AdminBillingPage() {
    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function loadStatus() {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch("/api/billing/status", { credentials: "include", cache: "no-store" });
            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
                setStatus(null);
                setErr(json?.error ?? `Erro ao carregar status (HTTP ${res.status})`);
                setLoading(false);
                return;
            }

            setStatus(json as StatusResponse);
            setLoading(false);
        } catch (e: any) {
            console.error(e);
            setStatus(null);
            setErr("Falha ao carregar status");
            setLoading(false);
        }
    }

    useEffect(() => {
        loadStatus();
    }, []);

    async function doUpgrade(plan_key: "mini_erp" | "full_erp") {
        setBusy(true);
        setErr(null);
        try {
            const res = await fetch("/api/billing/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan_key }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao alterar plano (HTTP ${res.status})`);
                return;
            }
            await loadStatus();
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao alterar plano");
        } finally {
            setBusy(false);
        }
    }

    async function allowOverage() {
        setBusy(true);
        setErr(null);
        try {
            const res = await fetch("/api/billing/allow-overage", {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao permitir overage (HTTP ${res.status})`);
                return;
            }
            await loadStatus();
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao permitir overage");
        } finally {
            setBusy(false);
        }
    }

    const planLabel = useMemo(() => {
        if (!status?.subscription) return "Sem subscription ativa";
        return `${status.subscription.plan_key}${status.subscription.plan_name ? ` (${status.subscription.plan_name})` : ""}`;
    }, [status]);

    const whatsapp = status?.usage?.whatsapp_messages ?? null;
    const whatsappLabel = useMemo(() => {
        if (!whatsapp) return "-";
        const lim = whatsapp.limit_per_month;
        if (lim == null) return `Uso: ${whatsapp.used} (sem limite definido)`;
        return `Uso: ${whatsapp.used} / ${lim} • Excedente: ${Math.max(0, whatsapp.used - lim)} • Vai exceder: ${whatsapp.will_overage_by}`;
    }, [whatsapp]);

    return (
        <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Admin Billing</h1>
                <button
                    onClick={loadStatus}
                    disabled={loading || busy}
                    style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #3B246B",
                        background: "#fff",
                        fontWeight: 900,
                        cursor: loading || busy ? "not-allowed" : "pointer",
                        opacity: loading || busy ? 0.6 : 1,
                    }}
                >
                    Atualizar
                </button>
            </div>

            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 14, background: "#fff", overflow: "hidden" }}>
                <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 900 }}>Status atual</div>

                <div style={{ padding: 12, display: "grid", gap: 10 }}>
                    {err ? <div style={{ color: "crimson", fontSize: 13 }}>{err}</div> : null}

                    {loading ? (
                        <div style={{ color: "#666" }}>Carregando...</div>
                    ) : !status ? (
                        <div style={{ color: "#666" }}>Sem dados (verifique permissões/endpoint).</div>
                    ) : (
                        <>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <Badge>company_id: {status.company_id}</Badge>
                                <Badge>plano: {planLabel}</Badge>
                                <Badge>allow_overage: {String(status.subscription?.allow_overage ?? false)}</Badge>
                                <Badge>features: {status.enabled_features_count}</Badge>
                            </div>

                            <div style={{ marginTop: 2, display: "grid", gap: 6 }}>
                                <div style={{ fontWeight: 900 }}>WhatsApp (mensagens/mês)</div>
                                <div style={{ fontSize: 13, color: "#333" }}>{whatsappLabel}</div>
                                <div style={{ fontSize: 12, color: "#666" }}>
                                    Status de envio:{" "}
                                    <b style={{ color: whatsapp?.allowed ? "green" : "crimson" }}>
                                        {whatsapp?.allowed ? "permitido" : "bloqueado (limite atingido e sem overage)"}
                                    </b>
                                </div>
                            </div>

                            <details style={{ marginTop: 8 }}>
                                <summary style={{ cursor: "pointer", fontWeight: 900 }}>Ver features habilitadas</summary>
                                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {status.enabled_features.length === 0 ? (
                                        <span style={{ color: "#666" }}>Nenhuma feature (provável falta de seed/plan_features)</span>
                                    ) : (
                                        status.enabled_features.map((f) => <Badge key={f}>{f}</Badge>)
                                    )}
                                </div>
                            </details>
                        </>
                    )}
                </div>
            </div>

            <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 14, background: "#fff", overflow: "hidden" }}>
                <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 900 }}>Ações (Dev/Admin)</div>

                <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <button
                        onClick={() => doUpgrade("mini_erp")}
                        disabled={busy}
                        style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid #3B246B",
                            background: "#fff",
                            fontWeight: 900,
                            cursor: busy ? "not-allowed" : "pointer",
                            opacity: busy ? 0.6 : 1,
                        }}
                        title="Cria/ativa subscription no plano mini_erp (encerra anterior)"
                    >
                        Ativar Mini ERP
                    </button>

                    <button
                        onClick={() => doUpgrade("full_erp")}
                        disabled={busy}
                        style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid #FF6600",
                            background: "#FF6600",
                            color: "#fff",
                            fontWeight: 900,
                            cursor: busy ? "not-allowed" : "pointer",
                            opacity: busy ? 0.6 : 1,
                        }}
                        title="Cria/ativa subscription no plano full_erp (encerra anterior)"
                    >
                        Ativar ERP Full
                    </button>

                    <button
                        onClick={allowOverage}
                        disabled={busy}
                        style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid #FF6600",
                            background: "#fff",
                            color: "#FF6600",
                            fontWeight: 900,
                            cursor: busy ? "not-allowed" : "pointer",
                            opacity: busy ? 0.6 : 1,
                        }}
                        title="Marca allow_overage=true na subscription ativa"
                    >
                        Permitir overage
                    </button>

                    <div style={{ marginLeft: "auto", color: "#666", fontSize: 12, alignSelf: "center" }}>
                        {busy ? "Processando..." : "Dica: use esta tela só para desenvolvimento/admin."}
                    </div>
                </div>
            </div>
        </div>
    );
}
