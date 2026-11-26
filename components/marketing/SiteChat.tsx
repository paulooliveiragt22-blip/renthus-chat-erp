"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_CHAT_TEXT_MAX } from "@/src/service/domain/siteChat";
import { cn } from "@/lib/utils";

const QUICK_REPLIES = ["Quais planos vocês têm?", "Quanto custa o Pro?", "Quero falar com alguém"] as const;

type Link = { label: string; url: string };

type Bubble = {
    id: string;
    role: "user" | "assistant";
    text: string;
    links: Link[];
};

type ChatPayload = {
    reply?: string;
    links?: Link[];
    remaining?: number | null;
    messages?: { role: "user" | "assistant"; body: string; links?: Link[] }[];
};

function greeting(now = new Date()): string {
    const hour = now.getHours();
    const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    return `${hello}. Em que posso ajudar? Qual é a sua dúvida?`;
}

export function SiteChat() {
    const inputId = useId();
    const titleId = useId();
    const panelRef = useRef<HTMLElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const startedRef = useRef(false);
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [hello, setHello] = useState<string | null>(null);
    const [bubbles, setBubbles] = useState<Bubble[]>([]);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [remaining, setRemaining] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resetNext, setResetNext] = useState(false);

    useEffect(() => {
        setHello(greeting());
    }, []);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.focus();
        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    useEffect(() => {
        if (!open || loaded) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/public/site-chat", { credentials: "include", cache: "no-store" });
                const json = (await res.json().catch(() => ({}))) as ChatPayload;
                if (cancelled || startedRef.current) return;
                const messages = Array.isArray(json.messages) ? json.messages : [];
                setBubbles(messages.map((item, index) => ({
                    id: `loaded-${index}`,
                    role: item.role,
                    text: item.body,
                    links: Array.isArray(item.links) ? item.links : [],
                })));
                if (typeof json.remaining === "number") setRemaining(json.remaining);
            } catch {
                if (!cancelled) setError("Não consegui abrir a conversa.");
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, loaded]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [bubbles, sending, open]);

    async function send(raw?: string) {
        const value = (raw ?? text).trim();
        if (!value || sending || remaining === 0) return;
        startedRef.current = true;
        setSending(true);
        setError(null);
        setText("");
        setBubbles((current) => [...current, { id: `user-${current.length}`, role: "user", text: value, links: [] }]);
        try {
            const res = await fetch("/api/public/site-chat", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: value, reset: resetNext }),
            });
            const json = (await res.json().catch(() => ({}))) as ChatPayload;
            setResetNext(false);
            if (typeof json.remaining === "number") setRemaining(json.remaining);
            if (!res.ok || typeof json.reply !== "string") {
                setError(typeof json.reply === "string" ? json.reply : "Não consegui responder agora.");
                return;
            }
            setBubbles((current) => [
                ...current,
                {
                    id: `assistant-${current.length}`,
                    role: "assistant",
                    text: json.reply ?? "",
                    links: Array.isArray(json.links) ? json.links : [],
                },
            ]);
        } catch {
            setError("Não consegui responder agora.");
        } finally {
            setSending(false);
        }
    }

    function startOver() {
        startedRef.current = false;
        setBubbles([]);
        setRemaining(null);
        setError(null);
        setResetNext(true);
        setLoaded(true);
        setHello(greeting());
    }

    const capped = remaining === 0;
    const hasUser = bubbles.some((bubble) => bubble.role === "user");
    const showQuick = !hasUser && !sending && !capped;

    return (
        <div className="fixed bottom-28 right-4 z-40 flex flex-col items-end gap-3 md:bottom-6">
            {open ? (
                <section
                    ref={panelRef}
                    role="dialog"
                    aria-modal="false"
                    aria-labelledby={titleId}
                    tabIndex={-1}
                    className="flex h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950"
                >
                    <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
                        <div className="min-w-0">
                            <h2 id={titleId} className="truncate text-base font-semibold text-slate-950 dark:text-zinc-50">Zampell</h2>
                            <p className="truncate text-sm text-slate-500 dark:text-zinc-400">Em que posso ajudar?</p>
                        </div>
                        <button
                            type="button"
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            aria-label="Fechar conversa"
                            onClick={() => setOpen(false)}
                        >
                            <X className="size-4" aria-hidden />
                        </button>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-relevant="additions">
                        {hello && !hasUser ? (
                            <p className="mr-8 whitespace-pre-wrap rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                                {hello}
                            </p>
                        ) : null}
                        {bubbles.map((bubble) => (
                            <div key={bubble.id} className={bubble.role === "user" ? "ml-8" : "mr-8"}>
                                <p className={cn(
                                    "whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
                                    bubble.role === "user"
                                        ? "bg-emerald-600 text-white"
                                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                                )}>
                                    {bubble.text}
                                </p>
                                {bubble.links.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {bubble.links.map((link) => (
                                            <a
                                                key={link.url}
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white"
                                            >
                                                {link.label}
                                            </a>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        {showQuick ? (
                            <div className="flex flex-wrap gap-2">
                                {QUICK_REPLIES.map((reply) => (
                                    <button
                                        key={reply}
                                        type="button"
                                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left text-sm font-medium text-emerald-800 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                                        onClick={() => void send(reply)}
                                    >
                                        {reply}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <div ref={bottomRef} />
                    </div>
                    {error ? <p className="px-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
                    <form
                        className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 dark:border-zinc-800"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void send();
                        }}
                    >
                        <label className="sr-only" htmlFor={inputId}>Mensagem</label>
                        <textarea
                            id={inputId}
                            value={text}
                            maxLength={SITE_CHAT_TEXT_MAX}
                            rows={2}
                            disabled={sending || capped}
                            onChange={(event) => setText(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void send();
                                }
                            }}
                            placeholder={capped ? "Limite desta conversa" : "Escreva sua dúvida"}
                            className="min-h-16 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                        />
                        <div className="flex items-center justify-between gap-2">
                            <button type="button" className="text-sm text-slate-500 underline-offset-2 hover:underline dark:text-zinc-400" onClick={startOver}>
                                Nova conversa
                            </button>
                            <Button type="submit" disabled={sending || capped || text.trim().length === 0}>
                                {sending ? "Enviando" : "Enviar"}
                            </Button>
                        </div>
                    </form>
                </section>
            ) : null}
            <Button
                type="button"
                className="shadow-lg"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                {open ? <X aria-hidden /> : <MessageCircle aria-hidden />}
                {open ? "Fechar" : "Tirar dúvida"}
            </Button>
        </div>
    );
}
