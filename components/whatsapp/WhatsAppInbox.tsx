"use client";

import React, { useEffect, useMemo, useState } from "react";

// Primary colour palette for the WhatsApp inbox.  Orange is used for primary
// actions (create conversation) and purple for secondary actions (send).
const ORANGE = "#FF6600";
const PURPLE = "#3B246B";

type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
    created_at: string;
};

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

function formatDT(ts?: string | null) {
    if (!ts) return "";
    try {
        return new Date(ts).toLocaleString("pt-BR");
    } catch {
        return ts || "";
    }
}

/**
 * Convert an input containing digits and optional punctuation into a valid
 * Brazilian E.164 number.  Handles plain 11-digit strings (e.g. 66999999999)
 * or values already prefaced with +55.  Returns either an E.164 string or an
 * error message.
 */
function normalizeBrazilToE164(input: string): { ok: true; e164: string } | { ok: false; error: string } {
    const raw = (input ?? "").trim();
    if (!raw) return { ok: false, error: "Telefone obrigatório" };

    // Accept already valid E.164 numbers
    if (raw.startsWith("+")) {
        const digits = raw.replace(/\s+/g, "");
        if (/^\+\d{8,16}$/.test(digits)) return { ok: true, e164: digits };
        return { ok: false, error: "Telefone inválido. Ex: +5566999999999" };
    }

    // Remove all non-digits
    const digits = raw.replace(/\D+/g, "");

    // If starts with country code 55 and length is acceptable
    if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 14) {
        const e164 = `+${digits}`;
        if (/^\+\d{8,16}$/.test(e164)) return { ok: true, e164 };
        return { ok: false, error: "Telefone inválido" };
    }

    // Expect DDD (2) + number (8 or 9)
    if (digits.length === 10 || digits.length === 11) {
        return { ok: true, e164: `+55${digits}` };
    }

    return { ok: false, error: "Use formato BR: 66999999999 (DDD + número)" };
}

/**
 * WhatsApp inbox component.  Displays a list of threads in the left column
 * and messages in the right column.  Allows starting a new conversation by
 * phone number.  Polls periodically for updates.  This component is a
 * client component because it uses `useState`, `useEffect`, and fetches
 * data on the client.
 */
export default function WhatsAppInbox() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [q, setQ] = useState("");
    const [loadingThreads, setLoadingThreads] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Modal state for creating a new conversation
    const [newOpen, setNewOpen] = useState(false);
    const [newPhoneBR, setNewPhoneBR] = useState("");
    const [newName, setNewName] = useState("");
    const [creatingThread, setCreatingThread] = useState(false);

    /**
     * Load threads from the API.  Accepts an optional thread ID to preserve
     * selection when refreshing or after creating a new thread.
     */
    async function loadThreads(nextSelectedId?: string | null) {
        setLoadingThreads(true);
        setErr(null);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "60");
            if (q.trim()) url.searchParams.set("q", q.trim());
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Erro ao carregar threads (HTTP ${res.status})`);
                setThreads([]);
                setLoadingThreads(false);
                return;
            }
            const list: Thread[] = Array.isArray(json.threads) ? json.threads : [];
            setThreads(list);
            // Preserve selection: if the provided nextSelectedId exists, use it;
            // otherwise keep current selection if it still exists; otherwise
            // select the first thread.
            const desired = nextSelectedId ?? selectedThreadId;
            if (desired && list.some((t) => t.id === desired)) {
                setSelectedThreadId(desired);
            } else if (!desired && list.length > 0) {
                setSelectedThreadId(list[0].id);
            } else if (desired && !list.some((t) => t.id === desired)) {
                setSelectedThreadId(list[0]?.id ?? null);
            }
            setLoadingThreads(false);
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao carregar threads");
            setThreads([]);
            setLoadingThreads(false);
        }
    }

    /**
     * Load messages for a given thread ID.
     */
    async function loadMessages(threadId: string) {
        setLoadingMessages(true);
        setErr(null);
        try {
            const url = new URL(`/api/whatsapp/threads/${threadId}/messages`, window.location.origin);
            url.searchParams.set("limit", "200");
            const res = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Erro ao carregar mensagens (HTTP ${res.status})`);
                setMessages([]);
                setLoadingMessages(false);
                return;
            }
            setMessages(Array.isArray(json.messages) ? json.messages : []);
            setLoadingMessages(false);
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao carregar mensagens");
            setMessages([]);
            setLoadingMessages(false);
        }
    }

    // Load threads on mount
    useEffect(() => {
        loadThreads();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load messages when selected thread changes
    useEffect(() => {
        if (selectedThreadId) {
            loadMessages(selectedThreadId);
        } else {
            setMessages([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Poll for updates every 8 seconds
    useEffect(() => {
        const id = window.setInterval(() => {
            loadThreads();
            if (selectedThreadId) loadMessages(selectedThreadId);
        }, 8000);
        return () => window.clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId, q]);

    const selectedThread = useMemo(() => threads.find((t) => t.id === selectedThreadId) ?? null, [threads, selectedThreadId]);

    /**
     * Send a message to the currently selected thread.  Calls the send API
     * and refreshes messages and threads on success.
     */
    async function sendMessage(text: string) {
        if (!selectedThread) return;
        const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ to_phone_e164: selectedThread.phone_e164, text }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setErr(json?.error ?? "Falha ao enviar mensagem");
            return;
        }
        await loadMessages(selectedThread.id);
        await loadThreads(selectedThread.id);
    }

    /**
     * Create a new WhatsApp thread by calling the create API.  The phone
     * number is converted from BR format to E.164 before sending.
     */
    async function createThread() {
        const name = newName.trim();
        const phoneParsed = normalizeBrazilToE164(newPhoneBR);
        if (!phoneParsed.ok) {
            setErr(phoneParsed.error);
            return;
        }
        setCreatingThread(true);
        setErr(null);
        try {
            const res = await fetch("/api/whatsapp/threads/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ phone_e164: phoneParsed.e164, profile_name: name || undefined }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao criar conversa (HTTP ${res.status})`);
                setCreatingThread(false);
                return;
            }
            const created: Thread | null = json.thread ?? null;
            const newId = created?.id ?? null;
            setNewOpen(false);
            setNewPhoneBR("");
            setNewName("");
            await loadThreads(newId);
            if (newId) await loadMessages(newId);
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao criar conversa");
        } finally {
            setCreatingThread(false);
        }
    }

    // Helper to display a hint for the phone input based on the current value
    const phoneHint = useMemo(() => {
        const v = newPhoneBR.trim();
        if (!v) return "Exemplo: 66999999999";
        const parsed = normalizeBrazilToE164(v);
        return parsed.ok ? `Vai salvar como: ${parsed.e164}` : parsed.error;
    }, [newPhoneBR]);

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr",
                gap: 12,
                padding: 12,
                height: "calc(100vh - 24px)",
                boxSizing: "border-box",
            }}
        >
            {/* Threads column */}
            <aside
                style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    background: "#fff",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                }}
            >
                <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900, color: PURPLE }}>WhatsApp</div>
                        <button
                            onClick={() => {
                                setErr(null);
                                setNewOpen(true);
                                setNewPhoneBR("");
                                setNewName("");
                            }}
                            style={{
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: `1px solid ${ORANGE}`,
                                cursor: "pointer",
                                fontWeight: 900,
                                background: ORANGE,
                                color: "#fff",
                            }}
                        >
                            + Nova conversa
                        </button>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Buscar por nome/telefone..."
                            style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd", outline: "none" }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = PURPLE;
                                e.currentTarget.style.boxShadow = `0 0 0 3px rgba(59,36,107,0.12)`;
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = "#ddd";
                                e.currentTarget.style.boxShadow = "none";
                            }}
                        />
                        <button
                            onClick={() => loadThreads()}
                            style={{
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: `1px solid ${PURPLE}`,
                                cursor: "pointer",
                                background: "#fff",
                                color: PURPLE,
                                fontWeight: 900,
                            }}
                        >
                            Buscar
                        </button>
                    </div>
                    {err ? <div style={{ marginTop: 10, color: "crimson", fontSize: 12 }}>{err}</div> : null}
                </div>
                <div style={{ overflowY: "auto", minHeight: 0 }}>
                    {loadingThreads ? (
                        <div style={{ padding: 12, color: "#666" }}>Carregando conversas...</div>
                    ) : threads.length === 0 ? (
                        <div style={{ padding: 12, color: "#666" }}>Nenhuma conversa.</div>
                    ) : (
                        threads.map((t) => {
                            const active = t.id === selectedThreadId;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setSelectedThreadId(t.id)}
                                    style={{
                                        width: "100%",
                                        textAlign: "left",
                                        border: "none",
                                        borderBottom: "1px solid #f1f1f1",
                                        padding: 12,
                                        cursor: "pointer",
                                        background: active ? "rgba(59,36,107,0.08)" : "#fff",
                                    }}
                                >
                                    <div style={{ fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 8 }}>
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {t.profile_name || t.phone_e164}
                                        </span>
                                        <span style={{ fontWeight: 700, fontSize: 11, color: "#666" }}>{formatDT(t.last_message_at)}</span>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>{t.phone_e164}</div>
                                    {t.last_message_preview ? (
                                        <div
                                            style={{
                                                marginTop: 4,
                                                fontSize: 12,
                                                color: "#666",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {t.last_message_preview}
                                        </div>
                                    ) : null}
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>
            {/* Messages column */}
            <section
                style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    background: "#fff",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                }}
            >
                <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
                    <div style={{ fontWeight: 900, color: PURPLE }}>
                        {selectedThread ? selectedThread.profile_name || selectedThread.phone_e164 : "Selecione uma conversa"}
                    </div>
                    {selectedThread ? (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>{selectedThread.phone_e164}</div>
                    ) : null}
                </div>
                <div style={{ padding: 12, overflowY: "auto", minHeight: 0, background: "#fafafa" }}>
                    {!selectedThread ? (
                        <div style={{ color: "#666" }}>Selecione uma conversa à esquerda.</div>
                    ) : loadingMessages ? (
                        <div style={{ color: "#666" }}>Carregando mensagens...</div>
                    ) : messages.length === 0 ? (
                        <div style={{ color: "#666" }}>Sem mensagens ainda.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                            {messages.map((m) => {
                                const isOut = m.direction === "out";
                                return (
                                    <div
                                        key={m.id}
                                        style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}
                                    >
                                        <div
                                            style={{
                                                maxWidth: 560,
                                                padding: "10px 12px",
                                                borderRadius: 12,
                                                border: `1px solid ${isOut ? "rgba(59,36,107,0.25)" : "#e6e6e6"}`,
                                                background: "#fff",
                                            }}
                                        >
                                            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body ?? ""}</div>
                                            <div style={{ marginTop: 6, fontSize: 11, color: "#666", display: "flex", gap: 8 }}>
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
                <MessageComposer disabled={!selectedThread} onSend={sendMessage} />
            </section>
            {newOpen ? (
                <Modal
                    title="Nova conversa"
                    onClose={() => {
                        if (!creatingThread) setNewOpen(false);
                    }}
                    footer={
                        <>
                            <button
                                onClick={() => setNewOpen(false)}
                                disabled={creatingThread}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: `1px solid ${PURPLE}`,
                                    cursor: creatingThread ? "not-allowed" : "pointer",
                                    opacity: creatingThread ? 0.6 : 1,
                                    background: "#fff",
                                    color: PURPLE,
                                    fontWeight: 900,
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={createThread}
                                disabled={creatingThread || !newPhoneBR.trim()}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: `1px solid ${ORANGE}`,
                                    cursor: creatingThread ? "not-allowed" : "pointer",
                                    opacity: creatingThread || !newPhoneBR.trim() ? 0.6 : 1,
                                    background: ORANGE,
                                    color: "#fff",
                                    fontWeight: 900,
                                }}
                            >
                                {creatingThread ? "Criando..." : "Criar"}
                            </button>
                        </>
                    }
                >
                    <div style={{ display: "grid", gap: 10 }}>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, color: PURPLE }}>Telefone (BR)</div>
                            <input
                                value={newPhoneBR}
                                onChange={(e) => setNewPhoneBR(e.target.value)}
                                placeholder="66999999999"
                                disabled={creatingThread}
                                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd", outline: "none" }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = PURPLE;
                                    e.currentTarget.style.boxShadow = `0 0 0 3px rgba(59,36,107,0.12)`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = "#ddd";
                                    e.currentTarget.style.boxShadow = "none";
                                }}
                            />
                            <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>{phoneHint}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, color: PURPLE }}>Nome (opcional)</div>
                            <input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Ex: João da Silva"
                                disabled={creatingThread}
                                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd", outline: "none" }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = PURPLE;
                                    e.currentTarget.style.boxShadow = `0 0 0 3px rgba(59,36,107,0.12)`;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = "#ddd";
                                    e.currentTarget.style.boxShadow = "none";
                                }}
                            />
                        </div>
                        <div style={{ fontSize: 11, color: "#666" }}>
                            Isso cria a conversa no banco sem enviar mensagem. Depois você envia normalmente.
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

/**
 * Message composer component.  Renders an input and send button.  Handles
 * sending the message on Enter keypress or clicking the button.  Disables
 * itself when there is no selected thread.
 */
function MessageComposer({
    disabled,
    onSend,
}: {
    disabled: boolean;
    onSend: (text: string) => Promise<void>;
}) {
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    async function handleSend() {
        const t = text.trim();
        if (!t || disabled) return;
        setSending(true);
        try {
            await onSend(t);
            setText("");
        } finally {
            setSending(false);
        }
    }
    return (
        <div style={{ borderTop: "1px solid #eee", padding: 12, background: "#fff" }}>
            <div style={{ display: "flex", gap: 8 }}>
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={disabled ? "Selecione uma conversa..." : "Digite uma mensagem..."}
                    disabled={disabled || sending}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid #ddd", outline: "none" }}
                    onFocus={(e) => {
                        e.currentTarget.style.borderColor = PURPLE;
                        e.currentTarget.style.boxShadow = `0 0 0 3px rgba(59,36,107,0.12)`;
                    }}
                    onBlur={(e) => {
                        e.currentTarget.style.borderColor = "#ddd";
                        e.currentTarget.style.boxShadow = "none";
                    }}
                />
                <button
                    onClick={handleSend}
                    disabled={disabled || sending || !text.trim()}
                    style={{
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: `1px solid ${PURPLE}`,
                        cursor: disabled || sending ? "not-allowed" : "pointer",
                        opacity: disabled || sending ? 0.6 : 1,
                        fontWeight: 900,
                        background: PURPLE,
                        color: "#fff",
                    }}
                >
                    {sending ? "Enviando..." : "Enviar"}
                </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>Dica: Enter envia • Shift+Enter quebra linha</div>
        </div>
    );
}

/**
 * Generic modal component used for creating a new conversation.  Closes when
 * clicking outside the content.  Footer buttons are provided via children.
 */
function Modal({
    title,
    children,
    footer,
    onClose,
}: {
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
    onClose: () => void;
}) {
    return (
        <div
            onMouseDown={(e) => {
                if (e.currentTarget === e.target) onClose();
            }}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                zIndex: 50,
            }}
        >
            <div
                style={{
                    width: "min(520px, 100%)",
                    background: "#fff",
                    borderRadius: 14,
                    border: "1px solid #eee",
                    overflow: "hidden",
                }}
            >
                <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 900, color: PURPLE }}>{title}</div>
                <div style={{ padding: 12 }}>{children}</div>
                <div
                    style={{
                        padding: 12,
                        borderTop: "1px solid #eee",
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 8,
                        background: "#fff",
                    }}
                >
                    {footer}
                </div>
            </div>
        </div>
    );
}