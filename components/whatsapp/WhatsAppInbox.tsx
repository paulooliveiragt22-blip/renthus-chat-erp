"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ChevronRight,
    Clock,
    File,
    Info,
    Mic,
    Paperclip,
    RefreshCcw,
    Send,
    ShoppingBag,
    Square,
    X,
} from "lucide-react";

// ─── types ───────────────────────────────────────────────────────────────────

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
    unread_count?: number;
};

type Message = {
    id: string;
    /** O banco grava "inbound"/"outbound" (valores legados) ou "in"/"out" */
    direction: "in" | "out" | "inbound" | "outbound";
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

type OrderItem = {
    product_name: string;
    quantity: number;
    unit_price: number;
    unit_type: string;
};

type CustomerOrder = {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    items: OrderItem[];
};

type CustomerProfile = {
    id: string;
    name: string | null;
    phone: string;
    totalSpent: number;
    orderCount: number;
    lastOrder: CustomerOrder | null;
    tags: string[];
};

type DetectedMedia =
    | { kind: "image"; url: string }
    | { kind: "video"; url: string }
    | { kind: "audio"; url: string }
    | { kind: "file"; url: string; name?: string };

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

function normalizeBrazilToE164(input: string): { ok: true; e164: string } | { ok: false; error: string } {
    const raw = (input ?? "").trim();
    if (!raw) return { ok: false, error: "Telefone obrigatório" };
    if (raw.startsWith("+")) {
        const digits = raw.replace(/\s+/g, "");
        if (/^\+\d{8,16}$/.test(digits)) return { ok: true, e164: digits };
        return { ok: false, error: "Telefone inválido. Ex: +5566999999999" };
    }
    const digits = raw.replace(/\D+/g, "");
    if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 14)
        return { ok: true, e164: `+${digits}` };
    if (digits.length === 10 || digits.length === 11) return { ok: true, e164: `+55${digits}` };
    return { ok: false, error: "Use formato BR: 66999999999 (DDD + número)" };
}

function getInitials(label: string) {
    return label
        .replace("+", "")
        .split(" ")
        .map((p) => p.trim()[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?";
}

function statusLabel(s: string) {
    const m: Record<string, string> = { new: "Novo", delivered: "Entregue", finalized: "Finalizado", canceled: "Cancelado" };
    return m[s] ?? s;
}

function statusColor(s: string) {
    const m: Record<string, string> = {
        new: "bg-blue-100 text-blue-700",
        delivered: "bg-emerald-100 text-emerald-700",
        finalized: "bg-violet-100 text-violet-700",
        canceled: "bg-zinc-100 text-zinc-500",
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

/**
 * Detecta se o texto de uma mensagem é uma URL de mídia ou um hash de arquivo
 * e retorna o tipo e a URL para renderização visual.
 */
function detectBodyMedia(body: string | null): DetectedMedia | null {
    if (!body) return null;
    const t = body.trim();

    // URL de mídia (imagem, vídeo, áudio)
    if (t.startsWith("http://") || t.startsWith("https://")) {
        try {
            const url = new URL(t);
            const p   = url.pathname.toLowerCase();
            if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(p)) return { kind: "image", url: t };
            if (/\.(mp4|webm|mov|avi)(\?|$)/.test(p))           return { kind: "video", url: t };
            if (/\.(mp3|ogg|wav|m4a|aac|opus)(\?|$)/.test(p))  return { kind: "audio", url: t };
            // Supabase Storage URL genérica
            if (url.hostname.includes("supabase")) return { kind: "file", url: t, name: p.split("/").pop() ?? "arquivo" };
        } catch { /* não é URL válida */ }
    }

    // Hash hexadecimal longo = media ID da Meta (armazenado no body por engano)
    if (/^[0-9a-f]{20,}$/i.test(t)) {
        return { kind: "file", url: `/api/whatsapp/media/${t}`, name: "arquivo" };
    }

    return null;
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function WhatsAppInbox() {
    const router  = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    const [threads,          setThreads]          = useState<Thread[]>([]);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [messages,         setMessages]         = useState<Message[]>([]);
    const [q,                setQ]                = useState("");
    const [loadingThreads,   setLoadingThreads]   = useState(true);
    const [loadingMessages,  setLoadingMessages]  = useState(false);
    const [err,              setErr]              = useState<string | null>(null);

    // modais
    const [newOpen,        setNewOpen]        = useState(false);
    const [newPhoneBR,     setNewPhoneBR]     = useState("");
    const [newName,        setNewName]        = useState("");
    const [creatingThread, setCreatingThread] = useState(false);

    // billing
    const [limitOpen,    setLimitOpen]    = useState(false);
    const [limitUsage,   setLimitUsage]   = useState<Usage | null>(null);
    const [pendingText,  setPendingText]  = useState<string | null>(null);
    const [billingBusy,  setBillingBusy]  = useState(false);
    const [botToggling,  setBotToggling]  = useState(false);

    // profile sidebar
    const [profileOpen,     setProfileOpen]     = useState(true);
    const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
    const [loadingProfile,  setLoadingProfile]  = useState(false);

    // scroll: sentinela no final da lista de mensagens
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // ── data ─────────────────────────────────────────────────────────────────

    async function loadThreads(nextSelectedId?: string | null) {
        setLoadingThreads(true);
        setErr(null);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "60");
            if (q.trim()) url.searchParams.set("q", q.trim());
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? `Erro ${res.status}`); setThreads([]); setLoadingThreads(false); return; }
            const list: Thread[] = Array.isArray(json.threads) ? json.threads : [];
            setThreads(list);
            const desired = nextSelectedId ?? selectedThreadId;
            if (desired && list.some((t) => t.id === desired)) setSelectedThreadId(desired);
            else if (!desired && list.length > 0) setSelectedThreadId(list[0].id);
            else if (desired && !list.some((t) => t.id === desired)) setSelectedThreadId(list[0]?.id ?? null);
            setLoadingThreads(false);
        } catch {
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
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? `Erro ${res.status}`); setMessages([]); setLoadingMessages(false); return; }
            setMessages(Array.isArray(json.messages) ? json.messages : []);
            setLoadingMessages(false);
        } catch {
            setErr("Falha ao carregar mensagens");
            setMessages([]);
            setLoadingMessages(false);
        }
    }

    async function loadCustomerProfile(phone: string) {
        setLoadingProfile(true);
        setCustomerProfile(null);
        try {
            const { data: cust } = await supabase
                .from("customers")
                .select("id, name, phone")
                .eq("phone", phone)
                .maybeSingle();

            if (!cust?.id) { setLoadingProfile(false); return; }

            const { data: ordersRaw } = await supabase
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

            setCustomerProfile({
                id:         cust.id,
                name:       cust.name,
                phone:      cust.phone,
                totalSpent: orders.reduce((s, o) => s + o.total_amount, 0),
                orderCount: orders.length,
                lastOrder:  orders[0] ?? null,
                tags:       buildTags(orders),
            });
        } catch { /* silently */ }
        setLoadingProfile(false);
    }

    // ── effects ───────────────────────────────────────────────────────────────

    useEffect(() => {
        loadThreads();
        supabaseRef.current = createClient();
        return () => { supabaseRef.current?.removeAllChannels(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedThreadId) loadMessages(selectedThreadId);
        else setMessages([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Carregar perfil ao trocar de conversa
    useEffect(() => {
        const t = threads.find((t) => t.id === selectedThreadId);
        if (t?.phone_e164) loadCustomerProfile(t.phone_e164);
        else setCustomerProfile(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Auto-scroll para a última mensagem — usa rAF para garantir que o DOM já renderizou
    useEffect(() => {
        if (loadingMessages) return;
        const id = requestAnimationFrame(() => {
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        });
        return () => cancelAnimationFrame(id);
    }, [messages, loadingMessages, selectedThreadId]);

    // Realtime
    useEffect(() => {
        const sb = supabaseRef.current;
        if (!sb) return;
        const channels: any[] = [];

        // ── threads: qualquer mudança → recarrega lista lateral ───────────────
        channels.push(
            sb.channel("whatsapp_threads_realtime")
                .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_threads" }, (payload: any) => {
                    console.log("Mudança detectada no Realtime [whatsapp_threads]:", payload);
                    loadThreads(selectedThreadId);
                })
                .subscribe((status: string) => {
                    console.log("[WhatsApp Realtime] threads canal status:", status);
                })
        );

        // ── messages: INSERT → append imediato + scroll | resto → reload ──────
        if (selectedThreadId) {
            channels.push(
                sb.channel(`whatsapp_messages_realtime_${selectedThreadId}`)
                    .on(
                        "postgres_changes",
                        { event: "*", schema: "public", table: "whatsapp_messages", filter: `thread_id=eq.${selectedThreadId}` },
                        (payload: any) => {
                            console.log("Mudança detectada no Realtime [whatsapp_messages]:", payload);

                            if (payload.eventType === "INSERT" && payload.new) {
                                const newMsg = payload.new as Message;
                                setMessages((prev) => {
                                    // Evita duplicata caso a mensagem já esteja no estado (ex: enviada pelo UI)
                                    if (prev.some((m) => m.id === newMsg.id)) return prev;
                                    return [...prev, newMsg];
                                });
                                // Scroll automático para a nova mensagem
                                requestAnimationFrame(() => {
                                    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                                });
                            } else {
                                // UPDATE ou DELETE → reload completo para consistência
                                loadMessages(selectedThreadId);
                            }
                        }
                    )
                    .subscribe((status: string) => {
                        console.log("[WhatsApp Realtime] messages canal status:", status);
                    })
            );
        }

        return () => { channels.forEach((ch) => sb.removeChannel(ch)); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId, q]);

    // ── derived ───────────────────────────────────────────────────────────────

    const selectedThread = useMemo(() => threads.find((t) => t.id === selectedThreadId) ?? null, [threads, selectedThreadId]);

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

    async function sendMessage(text: string, attachment?: { kind: "image" | "video" | "audio" | "document"; file: File }) {
        if (!selectedThread) return;
        let body: any = { to_phone_e164: selectedThread.phone_e164, text };
        if (attachment) {
            setErr(null);
            const form = new FormData();
            form.append("file", attachment.file);
            const uploadRes  = await fetch("/api/whatsapp/upload", { method: "POST", credentials: "include", body: form });
            const uploadJson = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) { setErr(uploadJson?.error ?? "Falha ao enviar arquivo"); return; }
            const mediaUrl = uploadJson?.url;
            if (!mediaUrl) { setErr("Resposta do upload sem URL"); return; }
            body = { to_phone_e164: selectedThread.phone_e164, kind: attachment.kind, media_url: mediaUrl, caption: text || undefined };
        }
        const res  = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (res.status === 402 && json?.error === "message_limit_reached" && json?.upgrade_required) {
            setErr(null); setPendingText(text); setLimitUsage(json?.usage ?? null); setLimitOpen(true); return;
        }
        if (!res.ok) { setErr(json?.error ?? "Falha ao enviar mensagem"); return; }
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
        finally { setBillingBusy(false); }
    }

    async function upgradeToFullAndRetry() {
        if (!pendingText || !selectedThread) return;
        setBillingBusy(true);
        try {
            const res  = await fetch("/api/billing/upgrade", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan_key: "full_erp" }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            setLimitOpen(false);
            await sendMessage(pendingText);
            setPendingText(null);
        } catch { setErr("Falha ao fazer upgrade"); }
        finally { setBillingBusy(false); }
    }

    async function toggleBot(threadId: string, newValue: boolean) {
        setBotToggling(true);
        try {
            const res  = await fetch(`/api/whatsapp/threads/${threadId}/bot-toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ bot_active: newValue }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); return; }
            setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, bot_active: newValue, handover_at: newValue ? null : t.handover_at } : t));
        } catch { setErr("Falha ao alterar bot"); }
        finally { setBotToggling(false); }
    }

    async function createThread() {
        const name        = newName.trim();
        const phoneParsed = normalizeBrazilToE164(newPhoneBR);
        if (!phoneParsed.ok) { setErr(phoneParsed.error); return; }
        setCreatingThread(true);
        setErr(null);
        try {
            const res  = await fetch("/api/whatsapp/threads/create", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ phone_e164: phoneParsed.e164, profile_name: name || undefined }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha"); setCreatingThread(false); return; }
            const newId = json.thread?.id ?? null;
            setNewOpen(false); setNewPhoneBR(""); setNewName("");
            await loadThreads(newId);
            if (newId) await loadMessages(newId);
        } catch { setErr("Falha ao criar conversa"); }
        finally { setCreatingThread(false); }
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
        // h-[calc(100vh-64px)]: 64px = padding top+bottom do AdminShell (py-4 = 32px, py-6 = 48px, usando 64px como margem segura)
        <div className="flex h-[calc(100vh-64px)] gap-3 overflow-hidden">

            {/* ── SIDEBAR ESQUERDA: threads ─────────────────────────────── */}
            <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">

                {/* header */}
                <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-primary">WhatsApp</span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => loadThreads()}
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                            >
                                <RefreshCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => { setErr(null); setNewOpen(true); setNewPhoneBR(""); setNewName(""); }}
                                className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-600 transition-colors"
                            >
                                + Nova
                            </button>
                        </div>
                    </div>

                    {threads.length > 0 && (
                        <p className="mb-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                            Conversas ativas:{" "}
                            <span className="font-semibold text-primary">{threads.length}</span>
                        </p>
                    )}

                    <div className="flex gap-2">
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && loadThreads()}
                            placeholder="Buscar..."
                            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-3 pr-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-primary/50 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <button
                            onClick={() => loadThreads()}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-primary hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-purple-400"
                        >
                            Ir
                        </button>
                    </div>

                    {err && <p className="mt-2 text-[11px] text-red-500">{err}</p>}
                </div>

                {/* lista de threads */}
                <div className="flex-1 overflow-y-auto">
                    {loadingThreads ? (
                        <div className="space-y-1 p-3">
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
                        <p className="p-4 text-xs text-zinc-400">Nenhuma conversa.</p>
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
                                    onClick={() => setSelectedThreadId(t.id)}
                                    className={`relative w-full border-b border-zinc-100 px-3 py-2.5 text-left transition-colors dark:border-zinc-800 ${
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
                                                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white shadow">
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
                                                    {expired   && <Clock className="h-3 w-3 text-zinc-400"   aria-label="Janela expirada" />}
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

            {/* ── ÁREA DE MENSAGENS ───────────────────────────────────────── */}
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">

                {/* cabeçalho do chat */}
                <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
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
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
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
                                    title={profileOpen ? "Ocultar perfil do cliente" : "Ver perfil do cliente"}
                                    className={`rounded-lg p-1.5 transition-colors ${
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
                <div className="flex-1 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
                    {!selectedThread ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="text-center">
                                <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-zinc-300" />
                                <p className="text-sm text-zinc-400">Selecione uma conversa à esquerda</p>
                            </div>
                        </div>
                    ) : loadingMessages ? (
                        <div className="space-y-3">
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
                                // "outbound" = enviado pelo ERP/bot; "inbound" = recebido do cliente
                                const isOut     = m.direction === "out" || m.direction === "outbound";
                                const rawMedia  = (m.raw_payload && (m.raw_payload as any)._media) || null;
                                const hasRawMedia = (m.num_media ?? 0) > 0 && rawMedia;
                                // Detecção de mídia embutida no body (URL ou hash de arquivo)
                                const bodyMedia = !hasRawMedia ? detectBodyMedia(m.body) : null;
                                // Texto a exibir (omitir se body inteiro é uma URL/hash de mídia)
                                const displayText = bodyMedia ? null : m.body;

                                return (
                                    <div
                                        key={m.id}
                                        className={`flex items-end gap-2 ${isOut ? "flex-row-reverse" : "flex-row"}`}
                                    >
                                        {/* Avatar pequeno para mensagens do cliente */}
                                        {!isOut && (
                                            <div className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-600 dark:bg-zinc-600 dark:text-zinc-200">
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
                                                            <File className="h-4 w-4 shrink-0" />
                                                            Abrir documento
                                                        </a>
                                                    )}
                                                </div>
                                            )}

                                            {/* Mídia detectada no body (URL ou hash) */}
                                            {bodyMedia && (
                                                <div className="mb-2">
                                                    {bodyMedia.kind === "image" ? (
                                                        <img src={bodyMedia.url} alt="Imagem" className="max-h-60 max-w-full rounded-xl object-cover" />
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
                                                            <File className="h-4 w-4 shrink-0" />
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
                                                <span>{formatDT(m.created_at)}</span>
                                                {isOut && <span>• {m.status ?? "sent"}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Sentinela de auto-scroll: sempre na última posição */}
                            <div ref={bottomRef} className="h-1 w-full" />
                        </div>
                    )}
                </div>

                {/* composer */}
                <MessageComposer disabled={!selectedThread} onSend={sendMessage} />
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
                <InlineModal title="Limite do plano atingido" onClose={() => { if (!billingBusy) setLimitOpen(false); }}>
                    <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                        <p>Você atingiu o limite mensal de mensagens. Escolha uma opção:</p>
                        {usageLabel && <p className="text-xs text-zinc-500">{usageLabel}</p>}
                        {pendingText && <p className="text-xs text-zinc-500">Mensagem: <span className="font-medium">"{pendingText.slice(0, 80)}"</span></p>}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <button onClick={() => setLimitOpen(false)} disabled={billingBusy} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Cancelar</button>
                        <button onClick={acceptOverageAndRetry} disabled={billingBusy} className="rounded-lg border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-50">{billingBusy ? "Processando..." : "Aceitar cobrança extra"}</button>
                        <button onClick={upgradeToFullAndRetry} disabled={billingBusy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{billingBusy ? "Processando..." : "Upgrade ERP Full"}</button>
                    </div>
                </InlineModal>
            )}

            {/* ── MODAL: nova conversa ───────────────────────────────────── */}
            {newOpen && (
                <InlineModal title="Nova conversa" onClose={() => { if (!creatingThread) setNewOpen(false); }}>
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-primary">Telefone (BR) *</label>
                            <input
                                value={newPhoneBR}
                                onChange={(e) => setNewPhoneBR(e.target.value)}
                                placeholder="66999999999"
                                disabled={creatingThread}
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            <p className="mt-1 text-[11px] text-zinc-400">{phoneHint}</p>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-600">Nome (opcional)</label>
                            <input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="João da Silva"
                                disabled={creatingThread}
                                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
                            />
                        </div>
                        <p className="text-[11px] text-zinc-400">Isso cria a conversa sem enviar mensagem.</p>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <button onClick={() => setNewOpen(false)} disabled={creatingThread} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Cancelar</button>
                        <button onClick={createThread} disabled={creatingThread || !newPhoneBR.trim()} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{creatingThread ? "Criando..." : "Criar conversa"}</button>
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
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">

            {/* Cabeçalho do perfil */}
            <div className="flex flex-col items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-5 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-white shadow-md">
                        {initials}
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
                <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{thread.phone_e164}</p>
                </div>
                {profile && profile.tags.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1 pt-1">
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
                    <div className="space-y-3 pt-2">
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
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600 transition-colors"
                            >
                                <RefreshCcw className="h-4 w-4" />
                                Repetir último pedido
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}

// ─── MessageComposer ──────────────────────────────────────────────────────────

function MessageComposer({ disabled, onSend }: {
    disabled: boolean;
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

    async function startRecording() {
        if (disabled || sending || isRecording) return;
        setRecordError(null);
        try {
            const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current  = stream;
            chunksRef.current  = [];
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
                try { await onSend("", { kind: "document", file: voiceFile }); } finally { setSending(false); }
            };
            recorder.start();
            setIsRecording(true);
        } catch (e: any) { setRecordError(e?.message ?? "Não foi possível acessar o microfone."); }
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
            setText(""); setFile(null); setFileKind(null);
            if (fileRef.current) fileRef.current.value = "";
        } finally { setSending(false); }
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
                    <button onClick={() => { setFile(null); setFileKind(null); if (fileRef.current) fileRef.current.value = ""; }} className="ml-auto shrink-0 text-zinc-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}
            {recordError && <p className="mb-1 text-[11px] text-red-500">{recordError}</p>}

            <div className="flex items-center gap-2">
                {/* Clipe (anexo) */}
                <label className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 ${disabled || sending || isRecording ? "pointer-events-none opacity-40" : ""}`}>
                    <Paperclip className="h-4 w-4" />
                    <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} disabled={disabled || sending || isRecording} />
                </label>

                {/* Microfone / Parar */}
                {!isRecording ? (
                    <button
                        type="button"
                        onClick={startRecording}
                        disabled={disabled || sending}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                        <Mic className="h-4 w-4" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={stopRecordingAndSend}
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100"
                    >
                        <Square className="h-3 w-3 fill-current" />
                        Parar
                    </button>
                )}

                {/* Campo de texto */}
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={disabled ? "Selecione uma conversa..." : "Digite uma mensagem..."}
                    disabled={disabled || sending}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />

                {/* Avião (enviar) */}
                <button
                    onClick={handleSend}
                    disabled={disabled || sending || (!text.trim() && !file)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-40"
                >
                    <Send className="h-4 w-4" />
                </button>
            </div>

            {isRecording && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-500">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    Gravando... Clique em "Parar" para enviar
                </p>
            )}
        </div>
    );
}

// ─── InlineModal ──────────────────────────────────────────────────────────────

function InlineModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void; }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <p className="text-sm font-bold text-primary">{title}</p>
                    <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
}
