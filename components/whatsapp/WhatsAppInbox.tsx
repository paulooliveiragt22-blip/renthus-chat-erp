"use client";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ChevronRight,
    Clock,
    File,
    Info,
    Menu,
    Mic,
    Paperclip,
    RefreshCcw,
    Send,
    ShoppingBag,
    Square,
    WifiOff,
    X,
} from "lucide-react";
import type {
    CustomerOrder,
    CustomerProfile,
    DetectedMedia,
    Message,
    Thread,
    Usage,
} from "@/lib/whatsapp/types";
import { getInitials, normalizeBrazilToE164 } from "@/lib/whatsapp/phone";
import { BillingModal } from "./BillingModal";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDT(ts?: string | null) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleString("pt-BR"); } catch { return ts || ""; }
}

function formatDateShort(ts?: string | null) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleDateString("pt-BR"); } catch { return ""; }
}

function formatBRL(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeAgo(ts?: string | null) {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

function hoursAgo(ts?: string | null): number {
    if (!ts) return 0;
    return (Date.now() - new Date(ts).getTime()) / 3600000;
}

function statusLabel(s: string) {
    const m: Record<string, string> = {
        new: "Novo",
        delivered: "Entregue",
        finalized: "Finalizado",
        canceled: "Cancelado",
    };
    return m[s] ?? s;
}

function statusColor(s: string) {
    const m: Record<string, string> = {
        new:       "bg-blue-100 text-blue-700",
        delivered: "bg-emerald-100 text-emerald-700",
        finalized: "bg-violet-100 text-violet-700",
        canceled:  "bg-zinc-100 text-zinc-500",
    };
    return m[s] ?? "bg-zinc-100 text-zinc-500";
}

function buildTags(orders: CustomerOrder[]): string[] {
    const tags: string[] = [];
    if (orders.length >= 10) tags.push("Cliente VIP");
    else if (orders.length >= 5) tags.push("Cliente Frequente");
    const total = orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    if (total >= 1000) tags.push("Alto Valor");
    const names: Record<string, number> = {};
    for (const o of orders) {
        for (const it of o.items) {
            const key = (it.product_name ?? "").toLowerCase();
            if (key) names[key] = (names[key] ?? 0) + (it.quantity ?? 1);
        }
    }
    const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [name] of top) {
        const label = name.charAt(0).toUpperCase() + name.slice(1, 20);
        if (!tags.some((t) => t === `Prefere ${label}`)) tags.push(`Prefere ${label}`);
    }
    return tags.slice(0, 5);
}

function detectBodyMedia(body: string | null): DetectedMedia | null {
    if (!body) return null;
    const t = body.trim();
    if (t.startsWith("http://") || t.startsWith("https://")) {
        try {
            const url = new URL(t);
            const p   = url.pathname.toLowerCase();
            if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(p)) return { kind: "image", url: t };
            if (/\.(mp4|webm|mov|avi)(\?|$)/.test(p))           return { kind: "video", url: t };
            if (/\.(mp3|ogg|wav|m4a|aac|opus)(\?|$)/.test(p))  return { kind: "audio", url: t };
            if (url.hostname.includes("supabase"))               return { kind: "file", url: t, name: p.split("/").pop() ?? "arquivo" };
        } catch { /* não é URL válida */ }
    }
    if (/^[0-9a-f]{20,}$/i.test(t)) return { kind: "file", url: `/api/whatsapp/media/${t}`, name: "arquivo" };
    return null;
}

// Check if scroll container is near the bottom (within 120px)
function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function WhatsAppInbox() {
    const router = useRouter();

    // Single Supabase client shared between queries and realtime
    const sbRef = useRef<ReturnType<typeof createClient> | null>(null);
    if (sbRef.current === null) sbRef.current = createClient();

    // ── state ─────────────────────────────────────────────────────────────────
    const [threads,          setThreads]          = useState<Thread[]>([]);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
        if (typeof window === "undefined") return null;
        return new URLSearchParams(window.location.search).get("t");
    });
    const [messages,         setMessages]         = useState<Message[]>([]);
    const [q,                setQ]                = useState("");
    const [loadingThreads,   setLoadingThreads]   = useState(true);
    const [loadingMessages,  setLoadingMessages]  = useState(false);
    const [err,              setErr]              = useState<string | null>(null);
    const [realtimeOk,       setRealtimeOk]       = useState(true);

    // mobile sidebar
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // modais
    const [newOpen,        setNewOpen]        = useState(false);
    const [newPhoneBR,     setNewPhoneBR]     = useState("");
    const [newName,        setNewName]        = useState("");
    const [creatingThread, setCreatingThread] = useState(false);

    // billing
    const [limitOpen,   setLimitOpen]   = useState(false);
    const [limitUsage,  setLimitUsage]  = useState<Usage | null>(null);
    const [pendingText, setPendingText] = useState<string | null>(null);
    const [billingBusy, setBillingBusy] = useState(false);
    const [botToggling, setBotToggling] = useState(false);

    // profile sidebar
    const [profileOpen,     setProfileOpen]     = useState(true);
    const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
    const [loadingProfile,  setLoadingProfile]  = useState(false);

    // refs
    const bottomRef         = useRef<HTMLDivElement | null>(null);
    const messagesAreaRef   = useRef<HTMLDivElement | null>(null);
    const threadsAbortRef   = useRef<AbortController | null>(null);
    const messagesAbortRef  = useRef<AbortController | null>(null);

    // Profile cache: phone → {profile, ts}
    const profileCacheRef = useRef<Map<string, { profile: CustomerProfile; ts: number }>>(new Map());

    // ── data ─────────────────────────────────────────────────────────────────

    const loadThreads = useCallback(async (nextSelectedId?: string | null) => {
        threadsAbortRef.current?.abort();
        const ctrl = new AbortController();
        threadsAbortRef.current = ctrl;

        setLoadingThreads(true);
        setErr(null);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "60");
            if (q.trim()) url.searchParams.set("q", q.trim());
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include", signal: ctrl.signal });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? `Erro ${res.status}`); setThreads([]); return; }
            const list: Thread[] = Array.isArray(json.threads) ? json.threads : [];
            setThreads(list);
            setSelectedThreadId((prev) => {
                const desired = nextSelectedId !== undefined ? nextSelectedId : prev;
                if (desired && list.some((t) => t.id === desired)) return desired;
                if (!desired && list.length > 0) return list[0].id;
                if (desired && !list.some((t) => t.id === desired)) return list[0]?.id ?? null;
                return prev;
            });
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            setErr("Falha ao carregar threads");
            setThreads([]);
        } finally {
            setLoadingThreads(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    const loadMessages = useCallback(async (threadId: string) => {
        messagesAbortRef.current?.abort();
        const ctrl = new AbortController();
        messagesAbortRef.current = ctrl;

        setLoadingMessages(true);
        setErr(null);
        try {
            const url = new URL(`/api/whatsapp/threads/${threadId}/messages`, window.location.origin);
            url.searchParams.set("limit", "200");
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include", signal: ctrl.signal });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? `Erro ${res.status}`); setMessages([]); return; }
            setMessages(Array.isArray(json.messages) ? json.messages : []);
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            setErr("Falha ao carregar mensagens");
            setMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    }, []);

    const markAsRead = useCallback(async (threadId: string) => {
        try {
            await fetch(`/api/whatsapp/threads/${threadId}/read`, { method: "POST", credentials: "include" });
            setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, unread_count: 0 } : t));
        } catch { /* silent */ }
    }, []);

    const loadCustomerProfile = useCallback(async (phone: string) => {
        const cached = profileCacheRef.current.get(phone);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
            setCustomerProfile(cached.profile);
            return;
        }
        setLoadingProfile(true);
        setCustomerProfile(null);
        const sb = sbRef.current!;
        try {
            const { data: cust } = await sb
                .from("customers")
                .select("id, name, phone")
                .eq("phone", phone)
                .maybeSingle();
            if (!cust?.id) return;

            const { data: ordersRaw } = await sb
                .from("orders")
                .select(`id, created_at, status, total_amount, order_items ( product_name, quantity, unit_price, unit_type )`)
                .eq("customer_id", cust.id)
                .order("created_at", { ascending: false })
                .limit(30);

            const orders: CustomerOrder[] = (ordersRaw ?? []).map((o: any) => ({
                id:           o.id,
                created_at:   o.created_at,
                status:       o.status ?? "new",
                total_amount: Number(o.total_amount ?? 0),
                items: Array.isArray(o.order_items)
                    ? o.order_items.map((it: any) => ({
                          product_name: it.product_name ?? "Item",
                          quantity:     Number(it.quantity ?? 1),
                          unit_price:   Number(it.unit_price ?? 0),
                          unit_type:    it.unit_type ?? "unit",
                      }))
                    : [],
            }));

            const profile: CustomerProfile = {
                id:         cust.id,
                name:       cust.name,
                phone:      cust.phone,
                totalSpent: orders.reduce((s, o) => s + o.total_amount, 0),
                orderCount: orders.length,
                lastOrder:  orders[0] ?? null,
                tags:       buildTags(orders),
            };
            profileCacheRef.current.set(phone, { profile, ts: Date.now() });
            setCustomerProfile(profile);
        } catch { /* silently */ }
        finally { setLoadingProfile(false); }
    }, []);

    // ── effects ───────────────────────────────────────────────────────────────

    // Initial load
    useEffect(() => {
        loadThreads();
        return () => {
            threadsAbortRef.current?.abort();
            messagesAbortRef.current?.abort();
            sbRef.current?.removeAllChannels();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced search (350ms)
    useEffect(() => {
        const t = setTimeout(() => loadThreads(), 350);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    // Load messages when thread changes
    useEffect(() => {
        if (selectedThreadId) {
            loadMessages(selectedThreadId);
            markAsRead(selectedThreadId);
            setSidebarOpen(false); // close mobile sidebar when thread selected
        } else {
            setMessages([]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Load customer profile when thread changes
    useEffect(() => {
        const t = threads.find((t) => t.id === selectedThreadId);
        if (t?.phone_e164) loadCustomerProfile(t.phone_e164);
        else setCustomerProfile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Persist selectedThreadId in URL
    useEffect(() => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (selectedThreadId) url.searchParams.set("t", selectedThreadId);
        else url.searchParams.delete("t");
        window.history.replaceState({}, "", url.toString());
    }, [selectedThreadId]);

    // Smart auto-scroll: only scroll if near bottom or first load
    useEffect(() => {
        if (loadingMessages) return;
        const area = messagesAreaRef.current;
        if (!area) return;
        // On first load of a thread, always scroll to bottom
        const id = requestAnimationFrame(() => {
            if (!messagesAreaRef.current) return;
            if (isNearBottom(messagesAreaRef.current) || loadingMessages === false) {
                bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }
        });
        return () => cancelAnimationFrame(id);
    }, [messages, loadingMessages, selectedThreadId]);

    // Realtime subscriptions — proper cleanup on thread/q change
    useEffect(() => {
        const sb = sbRef.current;
        if (!sb) return;

        const channels: ReturnType<typeof sb.channel>[] = [];

        // Threads channel
        const threadsCh = sb
            .channel("wa_threads_rt")
            .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_threads" }, () => {
                loadThreads(selectedThreadId);
            })
            .subscribe((status) => {
                setRealtimeOk(status === "SUBSCRIBED");
            });
        channels.push(threadsCh);

        // Messages channel for current thread
        if (selectedThreadId) {
            const msgCh = sb
                .channel(`wa_msgs_rt_${selectedThreadId}`)
                .on(
                    "postgres_changes",
                    {
                        event:  "*",
                        schema: "public",
                        table:  "whatsapp_messages",
                        filter: `thread_id=eq.${selectedThreadId}`,
                    },
                    (payload: any) => {
                        if (payload.eventType === "INSERT" && payload.new) {
                            const newMsg = payload.new as Message;
                            setMessages((prev) => {
                                if (prev.some((m) => m.id === newMsg.id)) return prev;
                                return [...prev, newMsg];
                            });
                            requestAnimationFrame(() => {
                                if (messagesAreaRef.current && isNearBottom(messagesAreaRef.current)) {
                                    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                                }
                            });
                        } else {
                            loadMessages(selectedThreadId);
                        }
                    }
                )
                .subscribe((status) => {
                    if (status === "CHANNEL_ERROR" || status === "CLOSED") setRealtimeOk(false);
                    if (status === "SUBSCRIBED") setRealtimeOk(true);
                });
            channels.push(msgCh);
        }

        return () => { channels.forEach((ch) => sb.removeChannel(ch)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // ── derived ───────────────────────────────────────────────────────────────

    const selectedThread = useMemo(
        () => threads.find((t) => t.id === selectedThreadId) ?? null,
        [threads, selectedThreadId]
    );

    const phoneHint = useMemo(() => {
        const v = newPhoneBR.trim();
        if (!v) return "Exemplo: 66999999999";
        const p = normalizeBrazilToE164(v);
        return p.ok ? `Vai salvar como: ${p.e164}` : p.error;
    }, [newPhoneBR]);

    const usageLabel = useMemo(() => {
        if (!limitUsage) return null;
        const lim = limitUsage.limit_per_month;
        return lim == null ? `Uso: ${limitUsage.used}` : `Uso: ${limitUsage.used} / ${lim}`;
    }, [limitUsage]);

    // ── actions ───────────────────────────────────────────────────────────────

    async function sendMessage(
        text: string,
        attachment?: { kind: "image" | "video" | "audio" | "document"; file: File }
    ) {
        if (!selectedThread) return;

        // Optimistic update
        const optimisticId = `opt_${Date.now()}`;
        const optimisticMsg: Message = {
            id:         optimisticId,
            direction:  "outbound",
            provider:   null,
            from_addr:  null,
            to_addr:    selectedThread.phone_e164,
            body:       text || (attachment ? `[${attachment.kind}]` : null),
            status:     "sending",
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMsg]);
        requestAnimationFrame(() => {
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        });

        let body: any = { to_phone_e164: selectedThread.phone_e164, text };

        if (attachment) {
            setErr(null);
            const form = new FormData();
            form.append("file", attachment.file);
            const uploadRes  = await fetch("/api/whatsapp/upload", { method: "POST", credentials: "include", body: form });
            const uploadJson = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                setErr(uploadJson?.error ?? "Falha ao enviar arquivo");
                return;
            }
            const mediaUrl = uploadJson?.url;
            if (!mediaUrl) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                setErr("Resposta do upload sem URL");
                return;
            }
            body = { to_phone_e164: selectedThread.phone_e164, kind: attachment.kind, media_url: mediaUrl, caption: text || undefined };
        }

        const res  = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));

        if (res.status === 402 && json?.error === "message_limit_reached" && json?.upgrade_required) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            setErr(null); setPendingText(text); setLimitUsage(json?.usage ?? null); setLimitOpen(true);
            return;
        }
        if (!res.ok) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            setErr(json?.error ?? "Falha ao enviar mensagem");
            return;
        }

        // Replace optimistic with real message list
        await loadMessages(selectedThread.id);
        await loadThreads(selectedThread.id);
    }

    async function acceptOverageAndRetry() {
        if (!pendingText || !selectedThread) return;
        setBillingBusy(true);
        try {
            const res  = await fetch("/api/billing/allow-overage", { method: "POST", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            setLimitOpen(false);
            await sendMessage(pendingText);
            setPendingText(null);
        } catch { setErr("Falha ao liberar overage"); }
        finally   { setBillingBusy(false); }
    }

    async function upgradeToFullAndRetry() {
        if (!pendingText || !selectedThread) return;
        setBillingBusy(true);
        try {
            const res  = await fetch("/api/billing/upgrade", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan_key: "full_erp" }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            setLimitOpen(false);
            await sendMessage(pendingText);
            setPendingText(null);
        } catch { setErr("Falha ao fazer upgrade"); }
        finally   { setBillingBusy(false); }
    }

    async function toggleBot(threadId: string, newValue: boolean) {
        setBotToggling(true);
        try {
            const res  = await fetch(`/api/whatsapp/threads/${threadId}/bot-toggle`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ bot_active: newValue }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            setThreads((prev) =>
                prev.map((t) =>
                    t.id === threadId ? { ...t, bot_active: newValue, handover_at: newValue ? null : t.handover_at } : t
                )
            );
        } catch { setErr("Falha ao alterar bot"); }
        finally   { setBotToggling(false); }
    }

    async function createThread() {
        const name        = newName.trim();
        const phoneParsed = normalizeBrazilToE164(newPhoneBR);
        if (!phoneParsed.ok) { setErr(phoneParsed.error); return; }
        setCreatingThread(true);
        setErr(null);
        try {
            const res  = await fetch("/api/whatsapp/threads/create", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ phone_e164: phoneParsed.e164, profile_name: name || undefined }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            const newId = json.thread?.id ?? null;
            setNewOpen(false); setNewPhoneBR(""); setNewName("");
            await loadThreads(newId);
            if (newId) await loadMessages(newId);
        } catch { setErr("Falha ao criar conversa"); }
        finally   { setCreatingThread(false); }
    }

    function repeatLastOrder() {
        if (!customerProfile?.lastOrder) return;
        if (typeof window !== "undefined") {
            window.localStorage.setItem("renthus_repeat_order", JSON.stringify({
                items: customerProfile.lastOrder.items,
                phone: customerProfile.phone,
                name:  customerProfile.name,
            }));
        }
        router.push("/pedidos?repeatOrder=1");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="flex h-[calc(100vh-64px)] gap-3 overflow-hidden">

            {/* Realtime disconnection banner */}
            {!realtimeOk && (
                <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 shadow-lg dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-300">
                    <WifiOff className="h-3.5 w-3.5" />
                    Realtime desconectado — recarregue se necessário
                </div>
            )}

            {/* ── SIDEBAR ESQUERDA: threads ─────────────────────────────── */}
            <aside
                className={`
                    flex shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm
                    dark:border-zinc-800 dark:bg-zinc-900
                    transition-all duration-200
                    w-[280px]
                    md:flex md:relative md:translate-x-0
                    ${sidebarOpen
                        ? "fixed inset-y-0 left-0 z-40 translate-x-0 rounded-none border-0 w-[280px]"
                        : "hidden md:flex"
                    }
                `}
                aria-label="Lista de conversas"
            >
                {/* header */}
                <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-primary">WhatsApp</span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => loadThreads()}
                                aria-label="Atualizar conversas"
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                                <RefreshCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => { setErr(null); setNewOpen(true); setNewPhoneBR(""); setNewName(""); }}
                                className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400/50"
                            >
                                + Nova
                            </button>
                            {/* Mobile close button */}
                            <button
                                onClick={() => setSidebarOpen(false)}
                                aria-label="Fechar menu"
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 md:hidden focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {threads.length > 0 && (
                        <p className="mb-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                            Conversas ativas:{" "}
                            <span className="font-semibold text-primary">{threads.length}</span>
                        </p>
                    )}

                    {/* Search with live debounce */}
                    <label htmlFor="wa-search" className="sr-only">Buscar conversas</label>
                    <input
                        id="wa-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Buscar por nome ou telefone..."
                        aria-label="Buscar conversas"
                        className="w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-3 pr-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />

                    {err && <p className="mt-2 text-[11px] text-red-500" role="alert">{err}</p>}
                </div>

                {/* lista de threads */}
                <div className="flex-1 overflow-y-auto" role="listbox" aria-label="Conversas">
                    {loadingThreads ? (
                        <div className="space-y-1 p-3" aria-label="Carregando conversas">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                                    <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="h-3 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                                        <div className="h-2.5 w-40 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800/60" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : threads.length === 0 ? (
                        <p className="p-4 text-xs text-zinc-400">
                            {q ? "Nenhum resultado." : "Nenhuma conversa."}
                        </p>
                    ) : (
                        threads.map((t) => {
                            const active    = t.id === selectedThreadId;
                            const label     = t.profile_name || t.phone_e164;
                            const initials  = getInitials(label);
                            const hours     = hoursAgo(t.last_message_at);
                            const nearClose = hours >= 20 && hours < 24;
                            const expired   = hours >= 24;

                            return (
                                <button
                                    key={t.id}
                                    role="option"
                                    aria-selected={active}
                                    onClick={() => setSelectedThreadId(t.id)}
                                    className={`relative w-full border-b border-zinc-100 px-3 py-2.5 text-left transition-colors dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/30 ${
                                        active
                                            ? "bg-primary/8 dark:bg-primary/20"
                                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    {active && (
                                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />
                                    )}
                                    <div className="flex items-center gap-2.5">
                                        {/* Avatar com badge não lidos */}
                                        <div className="relative shrink-0">
                                            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-primary text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"}`}>
                                                {initials}
                                            </div>
                                            {(t.unread_count ?? 0) > 0 && (
                                                <span
                                                    className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white shadow"
                                                    aria-label={`${t.unread_count} mensagens não lidas`}
                                                >
                                                    {t.unread_count! > 99 ? "99+" : t.unread_count}
                                                </span>
                                            )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <span className={`truncate text-xs font-semibold ${active ? "text-primary dark:text-purple-300" : "text-zinc-800 dark:text-zinc-100"}`}>
                                                    {label}
                                                </span>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {nearClose && <Clock className="h-3 w-3 text-orange-500" aria-label="Janela prestes a fechar" />}
                                                    {expired   && <Clock className="h-3 w-3 text-zinc-400"   aria-label="Janela de 24h expirada" />}
                                                    <span className="text-[10px] text-zinc-400">{timeAgo(t.last_message_at)}</span>
                                                </div>
                                            </div>
                                            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                                {t.last_message_preview || t.phone_e164}
                                            </p>
                                            {t.bot_active === false && (
                                                <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                                                    🤝 Humano
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* ── ÁREA DE MENSAGENS ───────────────────────────────────────── */}
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">

                {/* cabeçalho do chat */}
                <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    {/* Mobile: hamburguer */}
                    <button
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Abrir lista de conversas"
                        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 md:hidden focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                        <Menu className="h-4 w-4" />
                    </button>

                    {selectedThread ? (
                        <>
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                                    {getInitials(selectedThread.profile_name || selectedThread.phone_e164)}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                        {selectedThread.profile_name || selectedThread.phone_e164}
                                    </p>
                                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{selectedThread.phone_e164}</p>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                                {/* Toggle bot */}
                                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
                                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Bot</span>
                                    <button
                                        onClick={() => toggleBot(selectedThread.id, selectedThread.bot_active === false)}
                                        disabled={botToggling}
                                        aria-label={selectedThread.bot_active !== false ? "Pausar bot" : "Ativar bot"}
                                        aria-checked={selectedThread.bot_active !== false}
                                        role="switch"
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 ${
                                            selectedThread.bot_active !== false ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                                        }`}
                                    >
                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                            selectedThread.bot_active !== false ? "translate-x-4" : "translate-x-1"
                                        }`} />
                                    </button>
                                    <span className={`text-[10px] font-semibold ${selectedThread.bot_active !== false ? "text-emerald-600" : "text-zinc-400"}`}>
                                        {selectedThread.bot_active !== false ? "Ativo" : "Pausado"}
                                    </span>
                                </div>

                                {/* Botão Info para toggle do perfil */}
                                <button
                                    onClick={() => setProfileOpen((p) => !p)}
                                    aria-label={profileOpen ? "Ocultar perfil do cliente" : "Ver perfil do cliente"}
                                    aria-pressed={profileOpen}
                                    className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                                        profileOpen
                                            ? "bg-primary/10 text-primary dark:bg-primary/20"
                                            : "text-zinc-400 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    <Info className="h-4 w-4" />
                                </button>
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-zinc-400">Selecione uma conversa</p>
                    )}
                </div>

                {/* área de mensagens com scroll */}
                <div
                    ref={messagesAreaRef}
                    className="flex-1 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950"
                    aria-label="Mensagens"
                    aria-live="polite"
                    aria-atomic="false"
                >
                    {!selectedThread ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="text-center">
                                <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-zinc-300" aria-hidden="true" />
                                <p className="text-sm text-zinc-400">Selecione uma conversa à esquerda</p>
                            </div>
                        </div>
                    ) : loadingMessages ? (
                        <div className="space-y-3" aria-label="Carregando mensagens">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                                    <div className={`h-10 animate-pulse rounded-2xl ${i % 2 ? "w-48 bg-primary/20" : "w-56 bg-zinc-200 dark:bg-zinc-700"}`} />
                                </div>
                            ))}
                        </div>
                    ) : messages.length === 0 ? (
                        <p className="text-center text-xs text-zinc-400">Sem mensagens ainda.</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {messages.map((m) => {
                                const isOut     = m.direction === "out" || m.direction === "outbound";
                                const isSending = m.id.startsWith("opt_");
                                const rawMedia  = (m.raw_payload && (m.raw_payload as any)._media) || null;
                                const hasRawMedia = (m.num_media ?? 0) > 0 && rawMedia;
                                const bodyMedia = !hasRawMedia ? detectBodyMedia(m.body) : null;
                                const displayText = bodyMedia ? null : m.body;

                                return (
                                    <article
                                        key={m.id}
                                        className={`flex items-end gap-2 ${isOut ? "flex-row-reverse" : "flex-row"} ${isSending ? "opacity-60" : ""}`}
                                        aria-label={isOut ? "Mensagem enviada" : "Mensagem recebida"}
                                    >
                                        {!isOut && (
                                            <div className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-600 dark:bg-zinc-600 dark:text-zinc-200" aria-hidden="true">
                                                {getInitials(selectedThread?.profile_name || selectedThread?.phone_e164 || "?")}
                                            </div>
                                        )}

                                        <div className={`max-w-[75%] rounded-2xl px-3 py-2 shadow-sm ${
                                            isOut
                                                ? "rounded-br-sm bg-primary text-white"
                                                : "rounded-bl-sm bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                                        }`}>
                                            {/* Mídia do payload (Meta) */}
                                            {hasRawMedia && (
                                                <div className="mb-2">
                                                    {rawMedia.type === "image" ? (
                                                        <img
                                                            src={`/api/whatsapp/media/${rawMedia.id}`}
                                                            alt={rawMedia.caption || "Imagem"}
                                                            loading="lazy"
                                                            className="max-h-60 max-w-full rounded-xl object-cover"
                                                        />
                                                    ) : rawMedia.type === "video" ? (
                                                        <video controls src={`/api/whatsapp/media/${rawMedia.id}`} className="max-h-52 max-w-full rounded-xl" />
                                                    ) : rawMedia.type === "audio" ? (
                                                        <audio controls src={`/api/whatsapp/media/${rawMedia.id}`} className="w-52" />
                                                    ) : (
                                                        <a
                                                            href={`/api/whatsapp/media/${rawMedia.id}`}
                                                            target="_blank" rel="noreferrer"
                                                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold underline ${isOut ? "text-white/90" : "text-primary"}`}
                                                        >
                                                            <File className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                            Abrir documento
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {/* Mídia detectada no body */}
                                            {bodyMedia && (
                                                <div className="mb-2">
                                                    {bodyMedia.kind === "image" ? (
                                                        <img src={bodyMedia.url} alt="Imagem" loading="lazy" className="max-h-60 max-w-full rounded-xl object-cover" />
                                                    ) : bodyMedia.kind === "video" ? (
                                                        <video controls src={bodyMedia.url} className="max-h-52 max-w-full rounded-xl" />
                                                    ) : bodyMedia.kind === "audio" ? (
                                                        <audio controls src={bodyMedia.url} className="w-52" />
                                                    ) : (
                                                        <a
                                                            href={bodyMedia.url}
                                                            target="_blank" rel="noreferrer"
                                                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${isOut ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
                                                        >
                                                            <File className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                            {(bodyMedia as any).name || "Arquivo"}
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {/* Texto */}
                                            {displayText ? (
                                                <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>
                                            ) : !hasRawMedia && !bodyMedia ? (
                                                <p className={`text-xs italic ${isOut ? "text-white/60" : "text-zinc-400"}`}>Mensagem sem texto</p>
                                            ) : null}

                                            {/* Hora + status */}
                                            <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${isOut ? "justify-end text-white/60" : "text-zinc-400"}`}>
                                                <span>{isSending ? "Enviando..." : formatDT(m.created_at)}</span>
                                                {isOut && !isSending && <span>• {m.status ?? "sent"}</span>}
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                            <div ref={bottomRef} className="h-1 w-full" aria-hidden="true" />
                        </div>
                    )}
                </div>

                {/* composer */}
                <MessageComposer
                    disabled={!selectedThread}
                    threadId={selectedThreadId}
                    onSend={sendMessage}
                />
            </section>

            {/* ── SIDEBAR DIREITA: perfil do cliente ──────────────────────── */}
            {profileOpen && selectedThread && (
                <CustomerProfileSidebar
                    thread={selectedThread}
                    profile={customerProfile}
                    loading={loadingProfile}
                    onClose={() => setProfileOpen(false)}
                    onRepeatOrder={repeatLastOrder}
                />
            )}

            {/* ── MODAL: limite billing ──────────────────────────────────── */}
            {limitOpen && (
                <BillingModal
                    usage={limitUsage}
                    pendingText={pendingText}
                    busy={billingBusy}
                    onClose={() => { if (!billingBusy) setLimitOpen(false); }}
                    onAcceptOverage={acceptOverageAndRetry}
                    onUpgrade={upgradeToFullAndRetry}
                />
            )}

            {/* ── MODAL: nova conversa ───────────────────────────────────── */}
            {newOpen && (
                <InlineModal
                    title="Nova conversa"
                    onClose={() => { if (!creatingThread) setNewOpen(false); }}
                >
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="new-phone" className="mb-1 block text-xs font-semibold text-primary">
                                Telefone (BR) *
                            </label>
                            <input
                                id="new-phone"
                                required
                                value={newPhoneBR}
                                onChange={(e) => setNewPhoneBR(e.target.value)}
                                placeholder="66999999999"
                                disabled={creatingThread}
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            <p className="mt-1 text-[11px] text-zinc-400" aria-live="polite">{phoneHint}</p>
                        </div>
                        <div>
                            <label htmlFor="new-name" className="mb-1 block text-xs font-semibold text-zinc-600">
                                Nome (opcional)
                            </label>
                            <input
                                id="new-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="João da Silva"
                                disabled={creatingThread}
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800"
                            />
                        </div>
                        <p className="text-[11px] text-zinc-400">Isso cria a conversa sem enviar mensagem.</p>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            onClick={() => setNewOpen(false)}
                            disabled={creatingThread}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={createThread}
                            disabled={creatingThread || !newPhoneBR.trim()}
                            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                            {creatingThread ? "Criando..." : "Criar conversa"}
                        </button>
                    </div>
                </InlineModal>
            )}
        </div>
    );
}

// ─── CustomerProfileSidebar ───────────────────────────────────────────────────

function CustomerProfileSidebar({
    thread,
    profile,
    loading,
    onClose,
    onRepeatOrder,
}: {
    thread: Thread;
    profile: CustomerProfile | null;
    loading: boolean;
    onClose: () => void;
    onRepeatOrder: () => void;
}) {
    const name     = profile?.name || thread.profile_name || thread.phone_e164;
    const initials = getInitials(name);

    return (
        <aside
            className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 max-md:hidden"
            aria-label="Perfil do cliente"
        >
            {/* Cabeçalho do perfil */}
            <div className="flex flex-col items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-5 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-white shadow-md" aria-hidden="true">
                        {initials}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Fechar perfil do cliente"
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                </div>
                <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{thread.phone_e164}</p>
                </div>
                {profile && profile.tags.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1 pt-1" aria-label="Tags do cliente">
                        {profile.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary dark:bg-primary/20 dark:text-purple-300">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {loading ? (
                    <div className="space-y-3 pt-2" aria-label="Carregando perfil">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
                        ))}
                    </div>
                ) : !profile ? (
                    <div className="pt-6 text-center">
                        <p className="text-xs text-zinc-400">Nenhum pedido encontrado para este contato.</p>
                    </div>
                ) : (
                    <>
                        {/* Mini cards de stats */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
                                <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Total gasto</p>
                                <p className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-50">R$ {formatBRL(profile.totalSpent)}</p>
                            </div>
                            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
                                <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Pedidos</p>
                                <p className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-50">{profile.orderCount}</p>
                            </div>
                        </div>

                        {/* Último pedido */}
                        {profile.lastOrder ? (
                            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800">
                                <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                                    <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Último pedido</p>
                                    <div className="flex items-center gap-2">
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusColor(profile.lastOrder.status)}`}>
                                            {statusLabel(profile.lastOrder.status)}
                                        </span>
                                        <span className="text-[10px] text-zinc-400">{formatDateShort(profile.lastOrder.created_at)}</span>
                                    </div>
                                </div>

                                <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                                    {profile.lastOrder.items.slice(0, 5).map((it, idx) => (
                                        <div key={idx} className="flex items-center justify-between px-3 py-1.5">
                                            <span className="truncate text-[11px] text-zinc-700 dark:text-zinc-300">{it.product_name}</span>
                                            <span className="ml-2 shrink-0 text-[10px] font-semibold text-zinc-500">×{it.quantity}</span>
                                        </div>
                                    ))}
                                    {profile.lastOrder.items.length > 5 && (
                                        <p className="px-3 py-1 text-[10px] text-zinc-400">+{profile.lastOrder.items.length - 5} itens</p>
                                    )}
                                </div>

                                <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                                    <span className="text-[11px] text-zinc-500">Total</span>
                                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">R$ {formatBRL(profile.lastOrder.total_amount)}</span>
                                </div>
                            </div>
                        ) : (
                            <p className="text-center text-xs text-zinc-400">Sem pedidos anteriores.</p>
                        )}

                        {/* Botão repetir pedido */}
                        {profile.lastOrder && (
                            <button
                                onClick={onRepeatOrder}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400/50"
                            >
                                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                                Repetir último pedido
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}

// ─── MessageComposer ──────────────────────────────────────────────────────────

function MessageComposer({
    disabled,
    threadId,
    onSend,
}: {
    disabled: boolean;
    threadId: string | null;
    onSend: (text: string, attachment?: { kind: "image" | "video" | "audio" | "document"; file: File }) => Promise<void>;
}) {
    const [text,        setText]        = useState("");
    const [sending,     setSending]     = useState(false);
    const [file,        setFile]        = useState<File | null>(null);
    const [fileKind,    setFileKind]    = useState<"image" | "video" | "audio" | "document" | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordError, setRecordError] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef        = useRef<Blob[]>([]);
    const streamRef        = useRef<MediaStream | null>(null);
    const fileRef          = useRef<HTMLInputElement>(null);

    // Load draft from localStorage when thread changes
    useEffect(() => {
        if (!threadId) { setText(""); return; }
        const draft = typeof window !== "undefined"
            ? window.localStorage.getItem(`wa_draft_${threadId}`) ?? ""
            : "";
        setText(draft);
    }, [threadId]);

    // Save draft to localStorage (debounced)
    useEffect(() => {
        if (!threadId) return;
        const t = setTimeout(() => {
            if (text) window.localStorage.setItem(`wa_draft_${threadId}`, text);
            else window.localStorage.removeItem(`wa_draft_${threadId}`);
        }, 500);
        return () => clearTimeout(t);
    }, [text, threadId]);

    async function startRecording() {
        if (disabled || sending || isRecording) return;
        setRecordError(null);
        try {
            const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            chunksRef.current = [];
            const mime     = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
            const recorder = new MediaRecorder(stream, { mimeType: mime });
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                streamRef.current?.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
                const blob = new Blob(chunksRef.current, { type: mime });
                if (blob.size < 100) { setIsRecording(false); return; }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const voiceFile: File = new (window as any).File([blob], "voice.webm", { type: blob.type });
                setIsRecording(false);
                setSending(true);
                try { await onSend("", { kind: "document", file: voiceFile }); }
                finally { setSending(false); }
            };
            recorder.start();
            setIsRecording(true);
        } catch (e: any) {
            setRecordError(e?.message ?? "Não foi possível acessar o microfone.");
        }
    }

    function stopRecordingAndSend() {
        if (!isRecording || !mediaRecorderRef.current) return;
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
    }

    async function handleSend() {
        const t = text.trim();
        if ((disabled || sending) || (!t && !file)) return;
        setSending(true);
        try {
            if (file && fileKind) await onSend(t, { kind: fileKind, file });
            else await onSend(t);
            setText("");
            setFile(null); setFileKind(null);
            if (fileRef.current) fileRef.current.value = "";
            // Clear draft
            if (threadId) window.localStorage.removeItem(`wa_draft_${threadId}`);
        } finally {
            setSending(false);
        }
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0] || null;
        setFile(f);
        if (!f) { setFileKind(null); return; }
        const type = f.type;
        if (type.startsWith("image/")) setFileKind("image");
        else if (type.startsWith("video/")) setFileKind("video");
        else if (type.startsWith("audio/")) setFileKind("audio");
        else setFileKind("document");
    }

    return (
        <div className="border-t border-zinc-100 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            {/* preview de arquivo */}
            {file && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-zinc-800">
                    <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">{file.name}</span>
                    <button
                        onClick={() => { setFile(null); setFileKind(null); if (fileRef.current) fileRef.current.value = ""; }}
                        aria-label="Remover arquivo"
                        className="ml-auto shrink-0 text-zinc-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400/40 rounded"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>
            )}
            {recordError && <p className="mb-1 text-[11px] text-red-500" role="alert">{recordError}</p>}

            <div className="flex items-center gap-2">
                {/* Clipe (anexo) */}
                <label
                    aria-label="Anexar arquivo"
                    className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-primary/40 dark:border-zinc-700 dark:bg-zinc-800 ${disabled || sending || isRecording ? "pointer-events-none opacity-40" : ""}`}
                >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                    <input
                        ref={fileRef}
                        type="file"
                        className="sr-only"
                        onChange={handleFileChange}
                        disabled={disabled || sending || isRecording}
                    />
                </label>

                {/* Microfone / Parar */}
                {!isRecording ? (
                    <button
                        type="button"
                        onClick={startRecording}
                        disabled={disabled || sending}
                        aria-label="Gravar áudio"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                        <Mic className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={stopRecordingAndSend}
                        aria-label="Parar gravação e enviar"
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400/40"
                    >
                        <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                        Parar
                    </button>
                )}

                {/* Campo de texto */}
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={disabled ? "Selecione uma conversa..." : "Digite uma mensagem..."}
                    disabled={disabled || sending}
                    aria-label="Mensagem"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />

                {/* Avião (enviar) */}
                <button
                    onClick={handleSend}
                    disabled={disabled || sending || (!text.trim() && !file)}
                    aria-label={sending ? "Enviando mensagem" : "Enviar mensagem"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    <Send className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            {isRecording && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-500" role="status">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                    Gravando... Clique em &ldquo;Parar&rdquo; para enviar
                </p>
            )}
        </div>
    );
}

// ─── InlineModal ──────────────────────────────────────────────────────────────

function InlineModal({
    title,
    children,
    onClose,
}: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
}) {
    // Focus trap: focus first focusable element on mount
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        const focusable = el.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        focusable[0]?.focus();
    }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <div
                ref={dialogRef}
                className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            >
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <p className="text-sm font-bold text-primary">{title}</p>
                    <button
                        onClick={onClose}
                        aria-label="Fechar"
                        className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
}
