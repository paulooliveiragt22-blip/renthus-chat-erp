"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Message, Thread, Usage } from "@/lib/whatsapp/types";
import { BillingModal } from "./BillingModal";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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
                return;
            }
            setMessages(Array.isArray(json.messages) ? json.messages : []);
        } catch (e: unknown) {
            console.error(e);
            setError("Falha ao carregar mensagens");
            setMessages([]);
        } finally {
            setLoading(false);
        }
    }

    async function markAsRead() {
        try {
            await fetch(`/api/whatsapp/threads/${thread.id}/read`, { method: "POST", credentials: "include" });
        } catch (e) {
            console.warn("Falha ao marcar como lida", e);
        }
    }

    useEffect(() => {
        void loadMessages();
        void markAsRead();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thread.id]);

    async function sendMessageDirect(msg: string) {
        const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ to_phone_e164: thread.phone_e164, text: msg }),
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
        } catch (e: unknown) {
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
                setError(json?.error ?? "Falha ao liberar overage");
                return;
            }
            setLimitOpen(false);
            await sendMessageDirect(pendingText);
            setPendingText(null);
        } catch (e: unknown) {
            console.error(e);
            setError("Falha ao liberar overage");
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

    const sorted = useMemo(() => {
        return messages.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }, [messages]);

    return (
        <>
            <Dialog
                open
                onOpenChange={(next) => {
                    if (!next) onClose();
                }}
            >
                <DialogContent
                    hideClose
                    className="flex max-h-[90vh] w-full max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
                    aria-describedby={undefined}
                >
                    <DialogHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-3 py-3 pr-12 text-left">
                        <div>
                            <DialogTitle className="text-sm font-bold">
                                {thread.profile_name || thread.phone_e164}
                            </DialogTitle>
                            <p className="text-xs text-foreground-muted">{thread.phone_e164}</p>
                        </div>
                    </DialogHeader>

                    <div
                        className="flex-1 overflow-y-auto bg-zinc-50 p-3 dark:bg-zinc-950"
                        aria-label="Mensagens"
                        aria-live="polite"
                    >
                        {loading ? (
                            <p className="text-sm text-zinc-500">Carregando mensagens...</p>
                        ) : error ? (
                            <p className="text-xs text-red-600" role="alert">
                                {error}
                            </p>
                        ) : sorted.length === 0 ? (
                            <p className="text-sm text-zinc-500">Sem mensagens.</p>
                        ) : (
                            <div className="grid gap-2">
                                {sorted.map((m) => {
                                    const isOut = m.direction === "out" || m.direction === "outbound";
                                    return (
                                        <div
                                            key={m.id}
                                            className={`flex ${isOut ? "justify-end" : "justify-start"}`}
                                        >
                                            <div
                                                className={`max-w-[30rem] rounded-xl border px-3 py-2 ${
                                                    isOut
                                                        ? "border-primary bg-primary text-white"
                                                        : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                                }`}
                                            >
                                                <div className="whitespace-pre-wrap text-sm">{m.body ?? ""}</div>
                                                <div
                                                    className={`mt-1.5 flex gap-2 text-[10px] ${
                                                        isOut ? "text-white/60" : "text-zinc-500"
                                                    }`}
                                                >
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

                    <div className="shrink-0 border-t border-border bg-background-card p-3">
                        {error && (
                            <p className="mb-2 text-xs text-red-600" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="flex gap-2">
                            <input
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder="Digite sua resposta..."
                                disabled={sending}
                                aria-label="Mensagem"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                                className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                            />
                            <button
                                type="button"
                                onClick={() => void sendMessage()}
                                disabled={sending || !text.trim()}
                                className="rounded-xl bg-primary px-3.5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                            >
                                {sending ? "Enviando..." : "Enviar"}
                            </button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {limitOpen && (
                <BillingModal
                    usage={limitUsage}
                    pendingText={pendingText}
                    busy={billingBusy}
                    onClose={() => {
                        if (!billingBusy) setLimitOpen(false);
                    }}
                    onAcceptOverage={() => void acceptOverageAndRetry()}
                />
            )}
        </>
    );
}
