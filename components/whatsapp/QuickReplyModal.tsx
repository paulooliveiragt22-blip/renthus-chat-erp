"use client";

import React, { useEffect, useState, useMemo } from "react";

type Message = {
    id: string;
    direction: "in" | "out";
    provider: string | null;
    from_addr: string | null;
    to_addr: string | null;
    body: string | null;
    status: string | null;
    created_at: string;
};

type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
};

type Usage = {
    allowed: boolean;
    feature_key: string;
    year_month: string;
    used: number;
    limit_per_month: number | null;
    will_overage_by: number;
    allow_overage: boolean;
};

export default function QuickReplyModal({
    thread,
    onClose,
}: {
    thread: Thread;
    onClose: () => void;
}) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState<boolean>(false);
    const [text, setText] = useState<string>("");

    // ✅ upgrade modal state
    const [limitOpen, setLimitOpen] = useState(false);
    const [limitUsage, setLimitUsage] = useState<Usage | null>(null);
    const [pendingText, setPendingText] = useState<string | null>(null);
    const [billingBusy, setBillingBusy] = useState(false);

    async function loadMessages() {
        setLoading(true);
        setError(null);
        try {
            const url = new URL(`/api/whatsapp/threads/${thread.id}/messages`, window.location.origin);
            url.searchParams.set("limit", "200");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json?.error ?? `Erro ao carregar mensagens (HTTP ${res.status})`);
                setMessages([]);
                setLoading(false);
                return;
            }
            setMessages(Array.isArray(json.messages) ? json.messages : []);
            setLoading(false);
        } catch (e: any) {
            console.error(e);
            setError("Falha ao carregar mensagens");
            setMessages([]);
            setLoading(false);
        }
    }

    async function markAsRead() {
        try {
            await fetch(`/api/whatsapp/threads/${thread.id}/read`, {
                method: "POST",
                credentials: "include",
            });
        } catch (e) {
            console.warn("Falha ao marcar como lida", e);
        }
    }

    useEffect(() => {
        loadMessages();
        markAsRead();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thread.id]);

    async function sendMessageDirect(msg: string) {
        const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                to_phone_e164: thread.phone_e164,
                text: msg,
            }),
        });

        const json = await res.json().catch(() => ({}));

        if (res.status === 402 && json?.error === "message_limit_reached" && json?.upgrade_required) {
            setError(null);
            setPendingText(msg);
            setLimitUsage(json?.usage ?? null);
            setLimitOpen(true);
            return;
        }

        if (!res.ok) {
            setError(json?.error ?? `Erro ao enviar mensagem (HTTP ${res.status})`);
            return;
        }

        setText("");
        await loadMessages();
    }

    async function sendMessage() {
        const trimmed = text.trim();
        if (!trimmed) return;
        setSending(true);
        try {
            await sendMessageDirect(trimmed);
        } catch (e: any) {
            console.error(e);
            setError("Falha ao enviar mensagem");
        } finally {
            setSending(false);
        }
    }

    async function acceptOverageAndRetry() {
        if (!pendingText) return;
        setBillingBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/billing/allow-overage", { method: "POST", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json?.error ?? `Falha ao liberar overage (HTTP ${res.status})`);
                return;
            }
            setLimitOpen(false);
            await sendMessageDirect(pendingText);
            setPendingText(null);
        } catch (e: any) {
            console.error(e);
            setError("Falha ao liberar overage");
        } finally {
            setBillingBusy(false);
        }
    }

    async function upgradeToFullAndRetry() {
        if (!pendingText) return;
        setBillingBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/billing/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan_key: "full_erp" }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json?.error ?? `Falha ao fazer upgrade (HTTP ${res.status})`);
                return;
            }
            setLimitOpen(false);
            await sendMessageDirect(pendingText);
            setPendingText(null);
        } catch (e: any) {
            console.error(e);
            setError("Falha ao fazer upgrade");
        } finally {
            setBillingBusy(false);
        }
    }

    function formatDT(ts?: string | null) {
        if (!ts) return "";
        try {
            return new Date(ts).toLocaleString("pt-BR");
        } catch {
            return ts as string;
        }
    }

    const reversed = useMemo(() => {
        return messages.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }, [messages]);

    const usageLabel = useMemo(() => {
        if (!limitUsage) return null;
        const lim = limitUsage.limit_per_month;
        if (lim == null) return `Uso: ${limitUsage.used} (sem limite definido)`;
        return `Uso: ${limitUsage.used} / ${lim} • Excedente previsto: ${limitUsage.will_overage_by}`;
    }, [limitUsage]);

    return (
        <div
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                zIndex: 100,
            }}
        >
            <div
                style={{
                    width: "min(600px, 100%)",
                    maxHeight: "90vh",
                    background: "#fff",
                    borderRadius: 14,
                    border: "1px solid #eee",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* Cabeçalho */}
                <div style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <div style={{ fontWeight: 900 }}>{thread.profile_name || thread.phone_e164}</div>
                        <div style={{ fontSize: 12, color: "#666" }}>{thread.phone_e164}</div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ border: "none", background: "transparent", fontWeight: 900, fontSize: 18, cursor: "pointer" }}
                        title="Fechar"
                    >
                        ×
                    </button>
                </div>

                {/* Conteúdo: lista de mensagens */}
                <div style={{ padding: 12, overflowY: "auto", flex: 1, background: "#fafafa" }}>
                    {loading ? (
                        <div style={{ color: "#666" }}>Carregando mensagens...</div>
                    ) : error ? (
                        <div style={{ color: "crimson", fontSize: 12 }}>{error}</div>
                    ) : messages.length === 0 ? (
                        <div style={{ color: "#666" }}>Sem mensagens.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                            {reversed.map((m) => {
                                const isOut = m.direction === "out";
                                return (
                                    <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                                        <div
                                            style={{
                                                maxWidth: 480,
                                                padding: "10px 12px",
                                                borderRadius: 12,
                                                border: "1px solid #e6e6e6",
                                                background: "#fff",
                                            }}
                                        >
                                            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body ?? ""}</div>
                                            <div style={{ marginTop: 6, fontSize: 10, color: "#666", display: "flex", gap: 8 }}>
                                                <span>{formatDT(m.created_at)}</span>
                                                {isOut ? <span>• {m.status ?? "sent"}</span> : null}
                                                {m.provider ? <span>• {m.provider}</span> : null}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Compositor */}
                <div style={{ borderTop: "1px solid #eee", padding: 12, background: "#fff" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Digite sua resposta..."
                            disabled={sending}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    sendMessage();
                                }
                            }}
                            style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid #ddd", outline: "none" }}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={sending || !text.trim()}
                            style={{
                                padding: "12px 14px",
                                borderRadius: 12,
                                border: "1px solid #3B246B",
                                cursor: sending ? "not-allowed" : "pointer",
                                opacity: sending ? 0.6 : 1,
                                fontWeight: 900,
                                background: "#3B246B",
                                color: "#fff",
                            }}
                        >
                            {sending ? "Enviando..." : "Enviar"}
                        </button>
                    </div>
                </div>

                {/* Upgrade modal */}
                {limitOpen ? (
                    <div
                        onMouseDown={(e) => {
                            if (e.currentTarget === e.target && !billingBusy) setLimitOpen(false);
                        }}
                        style={{
                            position: "fixed",
                            inset: 0,
                            background: "rgba(0,0,0,0.35)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 16,
                            zIndex: 120,
                        }}
                    >
                        <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
                            <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 900, color: "#3B246B" }}>Limite do plano atingido</div>
                            <div style={{ padding: 12, display: "grid", gap: 10 }}>
                                <div style={{ fontSize: 13 }}>
                                    Você atingiu o limite mensal de mensagens. Para continuar enviando, escolha uma opção:
                                </div>
                                {usageLabel ? <div style={{ fontSize: 12, color: "#666" }}>{usageLabel}</div> : null}
                                <div style={{ fontSize: 12, color: "#666" }}>
                                    Mensagem pendente: <b>{pendingText ? `"${pendingText.slice(0, 80)}"` : "-"}</b>
                                </div>
                            </div>
                            <div style={{ padding: 12, borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                <button
                                    onClick={() => setLimitOpen(false)}
                                    disabled={billingBusy}
                                    style={{
                                        padding: "10px 12px",
                                        borderRadius: 10,
                                        border: "1px solid #3B246B",
                                        background: "#fff",
                                        color: "#3B246B",
                                        fontWeight: 900,
                                        cursor: billingBusy ? "not-allowed" : "pointer",
                                        opacity: billingBusy ? 0.6 : 1,
                                    }}
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={acceptOverageAndRetry}
                                    disabled={billingBusy}
                                    style={{
                                        padding: "10px 12px",
                                        borderRadius: 10,
                                        border: "1px solid #FF6600",
                                        background: "#fff",
                                        color: "#FF6600",
                                        fontWeight: 900,
                                        cursor: billingBusy ? "not-allowed" : "pointer",
                                        opacity: billingBusy ? 0.6 : 1,
                                    }}
                                >
                                    {billingBusy ? "Processando..." : "Aceitar cobrança extra"}
                                </button>
                                <button
                                    onClick={upgradeToFullAndRetry}
                                    disabled={billingBusy}
                                    style={{
                                        padding: "10px 12px",
                                        borderRadius: 10,
                                        border: "1px solid #FF6600",
                                        background: "#FF6600",
                                        color: "#fff",
                                        fontWeight: 900,
                                        cursor: billingBusy ? "not-allowed" : "pointer",
                                        opacity: billingBusy ? 0.6 : 1,
                                    }}
                                >
                                    {billingBusy ? "Processando..." : "Fazer upgrade (ERP Full)"}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
