"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Primary colour palette for the WhatsApp inbox.  Orange is used for primary
// actions (create conversation) and purple for secondary actions (send).
const ORANGE = "#FF6600";
const PURPLE = "#3B246B";

type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    avatar_url?: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
    created_at: string;
    bot_active: boolean | null;
    handover_at: string | null;
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
    num_media?: number | null;
    raw_payload?: any;
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
 * Brazilian E.164 number.
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

    // ✅ Upgrade/overage modal state
    const [limitOpen, setLimitOpen] = useState(false);
    const [limitUsage, setLimitUsage] = useState<Usage | null>(null);
    const [pendingText, setPendingText] = useState<string | null>(null);
    const [billingBusy, setBillingBusy] = useState(false);
    const [botToggling, setBotToggling] = useState(false);

    // refs para auto-scroll
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const autoScrollRef = useRef(true);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

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

    useEffect(() => {
        loadThreads();
        // inicializa supabase client para realtime
        supabaseRef.current = createClient();
        return () => {
            supabaseRef.current?.removeAllChannels();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedThreadId) {
            loadMessages(selectedThreadId);
        } else {
            setMessages([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Realtime: threads e mensagens
    useEffect(() => {
        const supabase = supabaseRef.current;
        if (!supabase) return;

        const channels: any[] = [];

        // Threads da empresa (atualizadas em tempo real)
        const threadsChannel = supabase
            .channel("whatsapp_threads_realtime")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "whatsapp_threads" },
                () => {
                    // recarrega lista mantendo seleção
                    loadThreads(selectedThreadId);
                }
            )
            .subscribe();
        channels.push(threadsChannel);

        // Mensagens da thread selecionada
        if (selectedThreadId) {
            const msgsChannel = supabase
                .channel(`whatsapp_messages_realtime_${selectedThreadId}`)
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "whatsapp_messages",
                        filter: `thread_id=eq.${selectedThreadId}`,
                    },
                    () => {
                        loadMessages(selectedThreadId);
                    }
                )
                .subscribe();
            channels.push(msgsChannel);
        }

        return () => {
            channels.forEach((ch) => {
                supabase.removeChannel(ch);
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId, q]);

    const selectedThread = useMemo(
        () => threads.find((t) => t.id === selectedThreadId) ?? null,
        [threads, selectedThreadId]
    );

    // Auto-scroll sempre que mensagens mudarem, se usuário estiver no final
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        if (!autoScrollRef.current) return;
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, [messages.length, selectedThreadId]);

    async function sendMessage(
        text: string,
        attachment?: { kind: "image" | "video" | "audio" | "document"; file: File }
    ) {
        if (!selectedThread) return;
        let body: any = { to_phone_e164: selectedThread.phone_e164, text };

        if (attachment) {
            setErr(null);
            const form = new FormData();
            form.append("file", attachment.file);
            const uploadRes = await fetch("/api/whatsapp/upload", {
                method: "POST",
                credentials: "include",
                body: form,
            });
            const uploadJson = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                setErr(uploadJson?.error ?? uploadJson?.details ?? "Falha ao enviar arquivo");
                return;
            }
            const mediaUrl = uploadJson?.url;
            if (!mediaUrl) {
                setErr("Resposta do upload sem URL");
                return;
            }
            body = {
                to_phone_e164: selectedThread.phone_e164,
                kind: attachment.kind,
                media_url: mediaUrl,
                caption: text || undefined,
            };
        }

        const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({}));

        // ✅ limite atingido → abre modal de upgrade/overage
        if (res.status === 402 && json?.error === "message_limit_reached" && json?.upgrade_required) {
            setErr(null);
            setPendingText(text);
            setLimitUsage(json?.usage ?? null);
            setLimitOpen(true);
            return;
        }

        if (!res.ok) {
            setErr(json?.error ?? "Falha ao enviar mensagem");
            return;
        }

        await loadMessages(selectedThread.id);
        await loadThreads(selectedThread.id);
    }

    async function acceptOverageAndRetry() {
        if (!pendingText || !selectedThread) return;
        setBillingBusy(true);
        setErr(null);
        try {
            const res = await fetch("/api/billing/allow-overage", {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao liberar overage (HTTP ${res.status})`);
                return;
            }
            setLimitOpen(false);
            // reenvia
            await sendMessage(pendingText);
            setPendingText(null);
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao liberar overage");
        } finally {
            setBillingBusy(false);
        }
    }

    async function upgradeToFullAndRetry() {
        if (!pendingText || !selectedThread) return;
        setBillingBusy(true);
        setErr(null);
        try {
            const res = await fetch("/api/billing/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan_key: "full_erp" }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao fazer upgrade (HTTP ${res.status})`);
                return;
            }
            setLimitOpen(false);
            // reenvia
            await sendMessage(pendingText);
            setPendingText(null);
        } catch (e: any) {
            console.error(e);
            setErr("Falha ao fazer upgrade");
        } finally {
            setBillingBusy(false);
        }
    }

    async function toggleBot(threadId: string, newValue: boolean) {
        setBotToggling(true);
        setErr(null);
        try {
            const res = await fetch(`/api/whatsapp/threads/${threadId}/bot-toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ bot_active: newValue }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json?.error ?? `Falha ao alterar bot (HTTP ${res.status})`);
            } else {
                // Atualiza estado local imediatamente
                setThreads((prev) =>
                    prev.map((t) =>
                        t.id === threadId
                            ? { ...t, bot_active: newValue, handover_at: newValue ? null : t.handover_at }
                            : t
                    )
                );
            }
        } catch (e: any) {
            setErr("Falha ao alterar bot");
        } finally {
            setBotToggling(false);
        }
    }

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

    const phoneHint = useMemo(() => {
        const v = newPhoneBR.trim();
        if (!v) return "Exemplo: 66999999999";
        const parsed = normalizeBrazilToE164(v);
        return parsed.ok ? `Vai salvar como: ${parsed.e164}` : parsed.error;
    }, [newPhoneBR]);

    const usageLabel = useMemo(() => {
        if (!limitUsage) return null;
        const lim = limitUsage.limit_per_month;
        if (lim == null) return `Uso: ${limitUsage.used} (sem limite definido)`;
        return `Uso: ${limitUsage.used} / ${lim} • Excedente previsto: ${limitUsage.will_overage_by}`;
    }, [limitUsage]);

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
                            const label = t.profile_name || t.phone_e164;
                            const initials = label
                                .replace("+", "")
                                .split(" ")
                                .map((p) => p.trim()[0])
                                .filter(Boolean)
                                .slice(0, 2)
                                .join("")
                                .toUpperCase();
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
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            alignItems: "center",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: "50%",
                                                    background: "#f0f0f0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: 13,
                                                    fontWeight: 900,
                                                    color: "#555",
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {initials || "?"}
                                            </div>
                                            <span
                                                style={{
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                    fontWeight: 900,
                                                }}
                                            >
                                                {label}
                                            </span>
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: 11, color: "#666", flexShrink: 0 }}>
                                            {formatDT(t.last_message_at)}
                                        </span>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: "#666", display: "flex", gap: 6, alignItems: "center" }}>
                                        <span>{t.phone_e164}</span>
                                        {t.bot_active === false && (
                                            <span style={{ fontSize: 10, color: "#e65100", fontWeight: 700 }}>🤝</span>
                                        )}
                                    </div>
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
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {selectedThread ? (
                                <div
                                    style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: "50%",
                                        background: "#f0f0f0",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 16,
                                        fontWeight: 900,
                                        color: "#555",
                                        flexShrink: 0,
                                    }}
                                >
                                    {(selectedThread.profile_name || selectedThread.phone_e164)
                                        .replace("+", "")
                                        .split(" ")
                                        .map((p) => p.trim()[0])
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .join("")
                                        .toUpperCase() || "?"}
                                </div>
                            ) : null}
                            <div>
                                <div style={{ fontWeight: 900, color: PURPLE }}>
                                    {selectedThread
                                        ? selectedThread.profile_name || selectedThread.phone_e164
                                        : "Selecione uma conversa"}
                                </div>
                                {selectedThread ? (
                                    <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>{selectedThread.phone_e164}</div>
                                ) : null}
                            </div>
                        </div>

                        {selectedThread ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                {/* Badge de status do bot */}
                                {selectedThread.bot_active === false ? (
                                    <span
                                        style={{
                                            fontSize: 11,
                                            padding: "3px 8px",
                                            borderRadius: 8,
                                            background: "#fff3e0",
                                            color: "#e65100",
                                            border: "1px solid #ffcc80",
                                            fontWeight: 700,
                                        }}
                                    >
                                        🤝 Atendimento humano
                                    </span>
                                ) : (
                                    <span
                                        style={{
                                            fontSize: 11,
                                            padding: "3px 8px",
                                            borderRadius: 8,
                                            background: "#e8f5e9",
                                            color: "#2e7d32",
                                            border: "1px solid #a5d6a7",
                                            fontWeight: 700,
                                        }}
                                    >
                                        🤖 Bot ativo
                                    </span>
                                )}

                                {/* Botão de toggle */}
                                <button
                                    onClick={() => toggleBot(selectedThread.id, selectedThread.bot_active === false)}
                                    disabled={botToggling}
                                    style={{
                                        padding: "6px 10px",
                                        borderRadius: 8,
                                        border: `1px solid ${selectedThread.bot_active === false ? "#2e7d32" : "#e65100"}`,
                                        cursor: botToggling ? "not-allowed" : "pointer",
                                        opacity: botToggling ? 0.6 : 1,
                                        background: "#fff",
                                        color: selectedThread.bot_active === false ? "#2e7d32" : "#e65100",
                                        fontWeight: 700,
                                        fontSize: 12,
                                        whiteSpace: "nowrap",
                                    }}
                                    title={selectedThread.bot_active === false ? "Reativar bot para esta conversa" : "Pausar bot e assumir atendimento"}
                                >
                                    {botToggling
                                        ? "..."
                                        : selectedThread.bot_active === false
                                        ? "Retomar bot"
                                        : "Pausar bot"}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div
                    ref={messagesContainerRef}
                    style={{ padding: 12, overflowY: "auto", minHeight: 0, background: "#fafafa" }}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                        autoScrollRef.current = distanceToBottom < 80;
                    }}
                >
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

                                // Detecta mídia resumida que salvamos em raw_payload._media
                                const media = (m.raw_payload && (m.raw_payload as any)._media) || null;
                                const hasMedia = (m.num_media ?? 0) > 0 && media;

                                return (
                                    <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                                        <div
                                            style={{
                                                maxWidth: 560,
                                                padding: "10px 12px",
                                                borderRadius: 12,
                                                border: `1px solid ${isOut ? "rgba(59,36,107,0.25)" : "#e6e6e6"}`,
                                                background: "#fff",
                                            }}
                                        >
                                            {hasMedia ? (
                                                <div style={{ marginBottom: m.body ? 8 : 0 }}>
                                                    {media.type === "image" ? (
                                                        <img
                                                            src={`/api/whatsapp/media/${media.id}`}
                                                            alt={media.caption || "Imagem recebida via WhatsApp"}
                                                            style={{
                                                                maxWidth: 260,
                                                                maxHeight: 260,
                                                                borderRadius: 12,
                                                                display: "block",
                                                                background: "#eee",
                                                            }}
                                                        />
                                                    ) : media.type === "video" ? (
                                                        <video
                                                            controls
                                                            src={`/api/whatsapp/media/${media.id}`}
                                                            style={{
                                                                maxWidth: 260,
                                                                maxHeight: 220,
                                                                borderRadius: 12,
                                                                background: "#eee",
                                                            }}
                                                        />
                                                    ) : media.type === "audio" ? (
                                                        <audio
                                                            controls
                                                            src={`/api/whatsapp/media/${media.id}`}
                                                            style={{ width: 220 }}
                                                        />
                                                    ) : media.type === "document" ? (
                                                        <div
                                                            style={{
                                                                borderRadius: 8,
                                                                padding: "8px 10px",
                                                                background: "#f1f1f1",
                                                                fontSize: 12,
                                                                color: "#555",
                                                            }}
                                                        >
                                                            <a
                                                                href={`/api/whatsapp/media/${media.id}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                style={{ color: PURPLE, fontWeight: 700 }}
                                                            >
                                                                Abrir documento
                                                            </a>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            {m.body ? (
                                                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
                                            ) : hasMedia ? null : (
                                                <div style={{ fontSize: 13, color: "#999" }}>Mensagem sem texto</div>
                                            )}

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

            {/* Modal: limite atingido / upgrade */}
            {limitOpen ? (
                <Modal
                    title="Limite do plano atingido"
                    onClose={() => {
                        if (!billingBusy) setLimitOpen(false);
                    }}
                    footer={
                        <>
                            <button
                                onClick={() => setLimitOpen(false)}
                                disabled={billingBusy}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: `1px solid ${PURPLE}`,
                                    cursor: billingBusy ? "not-allowed" : "pointer",
                                    opacity: billingBusy ? 0.6 : 1,
                                    background: "#fff",
                                    color: PURPLE,
                                    fontWeight: 900,
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
                                    border: `1px solid ${ORANGE}`,
                                    cursor: billingBusy ? "not-allowed" : "pointer",
                                    opacity: billingBusy ? 0.6 : 1,
                                    background: "#fff",
                                    color: ORANGE,
                                    fontWeight: 900,
                                }}
                                title="Libera continuar enviando e registra aceite de cobrança extra"
                            >
                                {billingBusy ? "Processando..." : "Aceitar cobrança extra"}
                            </button>

                            <button
                                onClick={upgradeToFullAndRetry}
                                disabled={billingBusy}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: `1px solid ${ORANGE}`,
                                    cursor: billingBusy ? "not-allowed" : "pointer",
                                    opacity: billingBusy ? 0.6 : 1,
                                    background: ORANGE,
                                    color: "#fff",
                                    fontWeight: 900,
                                }}
                                title="Troca para ERP Full e reenvia"
                            >
                                {billingBusy ? "Processando..." : "Fazer upgrade (ERP Full)"}
                            </button>
                        </>
                    }
                >
                    <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ color: "#333", fontSize: 13 }}>
                            Você atingiu o limite mensal de mensagens do seu plano. Para continuar enviando, escolha uma opção:
                        </div>

                        {usageLabel ? <div style={{ fontSize: 12, color: "#666" }}>{usageLabel}</div> : null}

                        <div style={{ fontSize: 12, color: "#666" }}>
                            Mensagem pendente: <span style={{ color: "#333", fontWeight: 700 }}>{pendingText ? `"${pendingText.slice(0, 80)}"` : "-"}</span>
                        </div>

                        <div style={{ fontSize: 11, color: "#666" }}>
                            Dica: “Aceitar cobrança extra” só libera continuar (flag <code>allow_overage</code>). “Upgrade” troca o plano da empresa.
                        </div>
                    </div>
                </Modal>
            ) : null}

            {/* Modal: nova conversa */}
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

function MessageComposer({
    disabled,
    onSend,
}: {
    disabled: boolean;
    onSend: (text: string, attachment?: { kind: "image" | "video" | "audio" | "document"; file: File }) => Promise<void>;
}) {
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [fileKind, setFileKind] = useState<"image" | "video" | "audio" | "document" | null>(null);

    async function handleSend() {
        const t = text.trim();
        if ((disabled || sending) || (!t && !file)) return;
        setSending(true);
        try {
            if (file && fileKind) {
                await onSend(t, { kind: fileKind, file });
            } else {
                await onSend(t);
            }
            setText("");
            setFile(null);
            setFileKind(null);
        } finally {
            setSending(false);
        }
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0] || null;
        setFile(f);
        if (!f) {
            setFileKind(null);
            return;
        }
        const type = f.type;
        if (type.startsWith("image/")) setFileKind("image");
        else if (type.startsWith("video/")) setFileKind("video");
        else if (type.startsWith("audio/")) setFileKind("audio");
        else setFileKind("document");
    }

    const placeholder = disabled ? "Selecione uma conversa..." : "Digite uma mensagem...";

    return (
        <div style={{ borderTop: "1px solid #eee", padding: 12, background: "#fff" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: disabled || sending ? "not-allowed" : "pointer",
                        background: "#fafafa",
                        fontSize: 18,
                    }}
                >
                    <span>📎</span>
                    <input
                        type="file"
                        onChange={handleFileChange}
                        disabled={disabled || sending}
                        style={{ display: "none" }}
                    />
                </label>
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={placeholder}
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
                    disabled={disabled || sending || (!text.trim() && !file)}
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
            <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>
                {file
                    ? `Anexo: ${file.name} (${fileKind ?? "arquivo"}) • Enter envia • Shift+Enter quebra linha`
                    : "Dica: Enter envia • Shift+Enter quebra linha"}
            </div>
        </div>
    );
}

/**
 * Generic modal component used for creating a new conversation / upgrade prompts.
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
