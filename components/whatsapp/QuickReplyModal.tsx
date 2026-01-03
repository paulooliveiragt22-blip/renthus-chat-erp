"use client";

import React, { useEffect, useState, useMemo } from "react";

// Define a Message type similar to the one used in WhatsAppInbox.
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

// Thread type aligned with AdminSidebar
type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
};

/**
 * QuickReplyModal
 *
 * Este componente exibe uma conversa em formato de modal flutuante, permitindo que o
 * usuário visualize as mensagens recentes e responda rapidamente sem sair da tela
 * atual. Ao abrir, ele marca a conversa como lida (POST /api/whatsapp/threads/:id/read).
 */
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

    // Carrega mensagens da thread
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

    // Marca a conversa como lida para o usuário atual
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

    // Envia uma resposta
    async function sendMessage() {
        const trimmed = text.trim();
        if (!trimmed) return;
        setSending(true);
        try {
            const res = await fetch("/api/whatsapp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    to_phone_e164: thread.phone_e164,
                    text: trimmed,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json?.error ?? `Erro ao enviar mensagem (HTTP ${res.status})`);
                setSending(false);
                return;
            }
            setText("");
            // Recarrega mensagens após enviar
            await loadMessages();
        } catch (e: any) {
            console.error(e);
            setError("Falha ao enviar mensagem");
        } finally {
            setSending(false);
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
        // Mostra mensagens da mais antiga para a mais recente (listagem "normal")
        return messages.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }, [messages]);

    return (
        <div
            onMouseDown={(e) => {
                // Fechar modal se clicar fora da caixa de diálogo
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
                                                background: isOut ? "#fff" : "#ffffff",
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

                {/* Compositor de mensagens */}
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
            </div>
        </div>
    );
}