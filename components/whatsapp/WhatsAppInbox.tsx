"use client";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import {
    Check,
    ChevronRight,
    Clock,
    Copy,
    Eraser,
    File,
    Info,
    MapPin,
    Menu,
    Mic,
    Paperclip,
    RefreshCcw,
    Send,
    ShoppingBag,
    ShoppingCart,
    Square,
    Wallet,
    X,
} from "lucide-react";
import type {
    ActiveCart,
    CustomerOrder,
    CustomerProfile,
    DetectedMedia,
    Message,
    PendingOrderConfirmation,
    Thread,
    ThreadHandoverInfo,
    Usage,
} from "@/lib/whatsapp/types";
import CartEditModal from "./CartEditModal";
import OrderSummaryModal from "./OrderSummaryModal";
import { getInitials, normalizeBrazilToE164 } from "@/lib/whatsapp/phone";
import {
    isCustomerServiceWindowClosing,
    isWithinCustomerServiceWindow,
} from "@/lib/whatsapp/customerServiceWindow";
import {
    channelBadgeLabel,
    threadDisplayName,
    threadDisplaySubtitle,
} from "@/src/domain/messaging/threadDisplay";
import { extractMediaFromWaPayload } from "@/lib/whatsapp/extractMediaFromWaPayload";
import { parseOptionalUuid } from "@/lib/whatsapp/urlSafety";
import { META_MEDIA_ID_PATH_RE, sanitizeWhatsAppMediaPathId } from "@/lib/whatsapp/mediaIdPath";
import { buildWaMediaRelativePath } from "@/lib/whatsapp/waMediaUrl";
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

function paymentLabel(m: string | null): string {
    const map: Record<string, string> = { pix: "Pix", cash: "Dinheiro", card: "Cartão" };
    return m ? (map[m] ?? m) : "-";
}

/** Acima disso, destaca o carrinho pro agente priorizar (carrinho de valor alto). */
const HIGH_VALUE_CART_THRESHOLD = 100;

/** `channelUuid` já validado (UUID) ou null — não passar query string da URL. */
function detectBodyMedia(body: string | null, channelUuid: string | null = null): DetectedMedia | null {
    if (!body) return null;
    const t = body.trim();
    if (t.startsWith("http://") || t.startsWith("https://")) {
        try {
            const url = new URL(t);
            if (url.protocol !== "http:" && url.protocol !== "https:") return null;
            const p   = url.pathname.toLowerCase();
            if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(p)) return { kind: "image", url: t };
            if (/\.(mp4|webm|mov|avi)(\?|$)/.test(p))           return { kind: "video", url: t };
            if (/\.(mp3|ogg|wav|m4a|aac|opus)(\?|$)/.test(p))  return { kind: "audio", url: t };
            if (url.hostname.includes("supabase"))               return { kind: "file", url: t, name: p.split("/").pop() ?? "arquivo" };
        } catch { /* não é URL válida */ }
    }
    if (META_MEDIA_ID_PATH_RE.test(t)) {
        const path = buildWaMediaRelativePath(t, channelUuid);
        if (!path) return null;
        return { kind: "file", url: path, name: "arquivo" };
    }
    return null;
}

// Check if scroll container is near the bottom (within 120px)
function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function WhatsAppInbox({ initialPhone }: { initialPhone?: string | null } = {}) {
    const router = useRouter();

    // ── state ─────────────────────────────────────────────────────────────────
    const [threads,          setThreads]          = useState<Thread[]>([]);
    /** Só IDs vindos da API / clique — `?t=` é aplicado em `loadThreads` após cruzar com a lista. */
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

    /** UUID opcional do query `t`, lido uma vez no cliente (fora do render de mídia). */
    const urlThreadCandidateRef = useRef<string | null>(null);
    const urlThreadConsumedRef  = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        urlThreadCandidateRef.current = parseOptionalUuid(
            new URLSearchParams(window.location.search).get("t")
        );
    }, []);
    const [messages,         setMessages]         = useState<Message[]>([]);
    const [q,                setQ]                = useState("");
    const [loadingThreads,   setLoadingThreads]   = useState(true);
    const [loadingMessages,  setLoadingMessages]  = useState(false);
    const [err,              setErr]              = useState<string | null>(null);

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

    // encerrar sessão / limpar carrinho
    const [resetSessionOpen, setResetSessionOpen] = useState(false);
    const [resetSessionBusy, setResetSessionBusy] = useState(false);
    const [resetSessionDone, setResetSessionDone] = useState<string | null>(null);

    // profile sidebar
    const [profileOpen,     setProfileOpen]     = useState(true);
    const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
    const [loadingProfile,  setLoadingProfile]  = useState(false);

    // carrinho ativo da thread (sessão do bot / abandonado) — facilita fechar pedido no atendimento humano
    const [activeCart,   setActiveCart]   = useState<ActiveCart | null>(null);
    const [loadingCart,  setLoadingCart]  = useState(false);
    const [handoverInfo, setHandoverInfo] = useState<ThreadHandoverInfo | null>(null);
    const [cartCopied,   setCartCopied]   = useState(false);
    // Solicitação de confirmação de pedido em aberto (atendente já pediu, aguardando resposta do cliente)
    const [pendingConfirmation,    setPendingConfirmation]    = useState<PendingOrderConfirmation | null>(null);
    const [cancelingConfirmation,  setCancelingConfirmation]  = useState(false);
    // Modal de montar/editar carrinho (produtos, endereço, pagamento) dentro do Inbox
    const [cartModalOpen, setCartModalOpen] = useState(false);
    // Modal de detalhe (read-only) de um pedido antigo — deep link da seção "Últimos pedidos"
    const [viewOrderId, setViewOrderId] = useState<string | null>(null);

    // refs
    const bottomRef         = useRef<HTMLDivElement | null>(null);
    const messagesAreaRef   = useRef<HTMLDivElement | null>(null);
    const threadsAbortRef   = useRef<AbortController | null>(null);
    const messagesAbortRef  = useRef<AbortController | null>(null);
    const prevThreadIdRef   = useRef<string | null>(null);
    /** Sempre em sincronia com `selectedThreadId` — lido dentro de `loadThreads` (que não pode
     * depender de `selectedThreadId` sem recriar a função a cada troca de conversa). */
    const selectedThreadIdRef = useRef<string | null>(null);

    // Profile cache: threadId → {profile, ts}
    const profileCacheRef = useRef<Map<string, { profile: CustomerProfile; ts: number }>>(new Map());

    // ── data ─────────────────────────────────────────────────────────────────

    /**
     * `silent`: atualiza a lista sem passar pelo skeleton — usado no refresh disparado por
     * realtime (`whatsapp_threads` muda a cada mensagem, então isso roda com muita frequência
     * numa caixa ativa). Sem isso, a tela "apaga e recarrega" a cada poucos segundos.
     */
    const loadThreads = useCallback(async (nextSelectedId?: string | null, opts?: { silent?: boolean }) => {
        threadsAbortRef.current?.abort();
        const ctrl = new AbortController();
        threadsAbortRef.current = ctrl;

        if (!opts?.silent) setLoadingThreads(true);
        setErr(null);
        try {
            const url = new URL("/api/whatsapp/threads", window.location.origin);
            url.searchParams.set("limit", "60");
            if (q.trim()) url.searchParams.set("q", q.trim());
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include", signal: ctrl.signal });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? `Erro ${res.status}`); setThreads([]); return; }
            const list: Thread[] = Array.isArray(json.threads) ? json.threads : [];
            setThreads((prevThreads) => {
                // Poll silencioso: se a conversa aberta caiu da página de mais recentes (outras
                // receberam mensagem depois), mantém a linha antiga dela na lista em vez de
                // deixá-la "desaparecer" do card esquerdo enquanto o agente está nela.
                const keepId = selectedThreadIdRef.current;
                if (!opts?.silent || !keepId || list.some((t) => t.id === keepId)) return list;
                const missing = prevThreads.find((t) => t.id === keepId);
                return missing ? [...list, missing] : list;
            });
            setSelectedThreadId((prev) => {
                const desired = nextSelectedId !== undefined ? nextSelectedId : prev;

                if (desired && list.some((t) => t.id === desired)) {
                    const row = list.find((t) => t.id === desired);
                    return row ? row.id : prev;
                }
                if (desired && !list.some((t) => t.id === desired)) {
                    /**
                     * Um poll silencioso em segundo plano NUNCA deve tirar o agente da conversa
                     * que ele está atendendo. A thread aberta pode simplesmente ter caído da
                     * página de `limit` mais recentes (outras conversas receberam mensagem
                     * depois) — isso não significa que ela deixou de existir. Só troca de
                     * conversa "à força" (fallback pra mais recente) numa ação explícita do
                     * usuário (load inicial, busca) — nunca no polling silencioso.
                     */
                    if (opts?.silent) return prev;
                    const fb = list[0];
                    return fb ? fb.id : null;
                }
                if (!desired && list.length > 0) {
                    const urlPick = !urlThreadConsumedRef.current ? urlThreadCandidateRef.current : null;
                    if (urlPick) {
                        const row = list.find((t) => t.id === urlPick);
                        if (row) {
                            urlThreadConsumedRef.current = true;
                            return row.id;
                        }
                    }
                    urlThreadConsumedRef.current = true;
                    return list[0].id;
                }
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

    /**
     * `silent`: usado pelo polling em segundo plano (ver efeito de polling abaixo) — não mostra
     * skeleton nem limpa a lista em erro transitório, e só substitui o estado se algo realmente
     * mudou (evita re-render/scroll a cada tick quando não chegou mensagem nova).
     */
    const loadMessages = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
        messagesAbortRef.current?.abort();
        const ctrl = new AbortController();
        messagesAbortRef.current = ctrl;

        if (!opts?.silent) { setLoadingMessages(true); setErr(null); }
        try {
            const url = new URL(`/api/whatsapp/threads/${threadId}/messages`, window.location.origin);
            url.searchParams.set("limit", "200");
            const res  = await fetch(url.toString(), { cache: "no-store", credentials: "include", signal: ctrl.signal });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (!opts?.silent) { setErr(json?.error ?? `Erro ${res.status}`); setMessages([]); }
                return;
            }
            const next: Message[] = Array.isArray(json.messages) ? json.messages : [];
            setMessages((prev) => {
                const prevLast = prev.at(-1);
                const nextLast = next.at(-1);
                if (prev.length === next.length && prevLast?.id === nextLast?.id && prevLast?.status === nextLast?.status) {
                    return prev;
                }
                return next;
            });
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            if (!opts?.silent) { setErr("Falha ao carregar mensagens"); setMessages([]); }
        } finally {
            if (!opts?.silent) setLoadingMessages(false);
        }
    }, []);

    const markAsRead = useCallback(async (threadId: string) => {
        try {
            await fetch(`/api/whatsapp/threads/${threadId}/read`, { method: "POST", credentials: "include" });
            setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, unread_count: 0 } : t));
        } catch { /* silent */ }
    }, []);

    const loadCustomerProfile = useCallback(async (threadId: string) => {
        const cached = profileCacheRef.current.get(threadId);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
            setCustomerProfile(cached.profile);
            return;
        }
        setLoadingProfile(true);
        setCustomerProfile(null);
        try {
            const res  = await fetch(`/api/whatsapp/threads/${threadId}/orders`, { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.customer) return;

            const orders: CustomerOrder[] = Array.isArray(json.orders) ? json.orders : [];
            const c = json.customer as { id: string; name: string | null; phone: string | null; totalSpent: number; orderCount: number; tags: string[] };
            const profile: CustomerProfile = {
                id:         c.id,
                name:       c.name,
                phone:      c.phone,
                totalSpent: c.totalSpent,
                orderCount: c.orderCount,
                lastOrder:  orders[0] ?? null,
                orders,
                tags:       c.tags ?? [],
            };
            profileCacheRef.current.set(threadId, { profile, ts: Date.now() });
            setCustomerProfile(profile);
        } catch { /* silently */ }
        finally { setLoadingProfile(false); }
    }, []);

    const loadActiveCart = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoadingCart(true);
        try {
            const res  = await fetch(`/api/whatsapp/threads/${threadId}/cart`, { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setActiveCart(null); setHandoverInfo(null); setPendingConfirmation(null); return; }
            setActiveCart((json.cart ?? null) as ActiveCart | null);
            setHandoverInfo((json.handover ?? null) as ThreadHandoverInfo | null);
            setPendingConfirmation((json.pendingConfirmation ?? null) as PendingOrderConfirmation | null);
        } catch {
            setActiveCart(null);
            setHandoverInfo(null);
            setPendingConfirmation(null);
        } finally {
            setLoadingCart(false);
        }
    }, []);

    function copyCartSummary() {
        const items = activeCart?.items ?? [];
        if (items.length === 0) return;
        const total = items.reduce((s, it) => s + it.subtotal, 0);
        const lines = items.map(
            (it) => `• ${it.quantity}x ${it.productName}${it.sigla ? ` (${it.sigla})` : ""} — R$ ${formatBRL(it.subtotal)}`
        );
        const text = ["Carrinho do cliente:", ...lines, `Total: R$ ${formatBRL(total)}`].join("\n");
        navigator.clipboard?.writeText(text)
            .then(() => {
                setCartCopied(true);
                globalThis.setTimeout(() => setCartCopied(false), 2000);
            })
            .catch(() => { /* clipboard indisponível (http/permissão) — ignora */ });
    }

    async function cancelPendingConfirmation() {
        if (!selectedThreadId) return;
        setCancelingConfirmation(true);
        try {
            await fetch(`/api/whatsapp/threads/${selectedThreadId}/cart/cancel-confirmation`, {
                method: "POST",
                credentials: "include",
            });
        } catch { /* best-effort */ }
        finally {
            setCancelingConfirmation(false);
            loadActiveCart(selectedThreadId);
        }
    }

    // ── effects ───────────────────────────────────────────────────────────────

    // Initial load
    useEffect(() => {
        loadThreads();
        return () => {
            threadsAbortRef.current?.abort();
            messagesAbortRef.current?.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced search (350ms)
    useEffect(() => {
        const t = setTimeout(() => loadThreads(), 350);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    useEffect(() => {
        selectedThreadIdRef.current = selectedThreadId;
    }, [selectedThreadId]);

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

    // Auto-select thread by phone when initialPhone is provided (embedded mode)
    const initialPhoneAppliedRef = useRef(false);
    useEffect(() => {
        if (!initialPhone || initialPhoneAppliedRef.current || threads.length === 0) return;
        const normalize = (p: string) => p.replaceAll(/\D/g, "").replaceAll(/^55/g, "");
        const target = normalize(initialPhone);
        const match = threads.find((t) => t.phone_e164 && normalize(t.phone_e164) === target);
        if (match) {
            setSelectedThreadId(match.id);
            initialPhoneAppliedRef.current = true;
        }
    }, [threads, initialPhone]);

    // Load customer profile when thread changes
    useEffect(() => {
        if (selectedThreadId) loadCustomerProfile(selectedThreadId);
        else setCustomerProfile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // Load active cart when thread changes
    useEffect(() => {
        setCartCopied(false);
        if (selectedThreadId) {
            loadActiveCart(selectedThreadId);
        } else {
            setActiveCart(null);
            setHandoverInfo(null);
            setPendingConfirmation(null);
        }
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

    // Smart auto-scroll: instant on thread change, smooth on new messages near bottom
    useEffect(() => {
        if (loadingMessages) return;
        const area = messagesAreaRef.current;
        if (!area) return;

        const id = requestAnimationFrame(() => {
            const a = messagesAreaRef.current;
            if (!a) return;

            const isNewThread = selectedThreadId !== prevThreadIdRef.current;
            prevThreadIdRef.current = selectedThreadId;

            if (isNewThread) {
                // Primeira carga da thread: pulo instantâneo sem animação
                a.scrollTop = a.scrollHeight;
            } else if (isNearBottom(a)) {
                // Nova mensagem chegou e já estávamos perto do final: scroll suave
                a.scrollTo({ top: a.scrollHeight, behavior: "smooth" });
            }
        });
        return () => cancelAnimationFrame(id);
    }, [messages, loadingMessages, selectedThreadId]);

    /**
     * Polling em segundo plano (silencioso) em vez de `postgres_changes`.
     *
     * `whatsapp_threads`/`whatsapp_messages` têm RLS travada em `service_role` (por design —
     * ver regra de governança: SELECT de tabela crua não é permitido pro client/browser). Isso
     * significa que uma subscrição `postgres_changes` feita com o client anon/authenticated do
     * browser nunca recebe evento nenhum dessas tabelas: o canal “conecta”, mas nenhuma
     * mudança é entregue, e qualquer soquete que cair vira o banner falso de "desconectado".
     * Esse é o motivo raiz do atraso relatado — a lista de threads e o painel de mensagens
     * dependiam de um mecanismo que estruturalmente não pode funcionar com esse RLS.
     * `PedidosClient.tsx` já resolve o mesmo problema (mesma trava em `orders`/`order_items`)
     * com polling via API; replicamos o padrão aqui.
     */
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.hidden) return;
            loadThreads(undefined, { silent: true });
        }, 5000);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedThreadId) return;
        const timer = setInterval(() => {
            if (document.hidden) return;
            loadMessages(selectedThreadId, { silent: true });
            loadActiveCart(selectedThreadId, { silent: true });
        }, 3000);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedThreadId]);

    // ── derived ───────────────────────────────────────────────────────────────

    const selectedThread = useMemo(
        () => threads.find((t) => t.id === selectedThreadId) ?? null,
        [threads, selectedThreadId]
    );

    /** UUID do canal só a partir da thread carregada na lista (dados do servidor). */
    const waMediaChannelUuid = useMemo(
        () => parseOptionalUuid(selectedThread?.channel_id?.trim() ?? null),
        [selectedThread?.channel_id]
    );

    const phoneHint = useMemo(() => {
        const v = newPhoneBR.trim();
        if (!v) return "Exemplo: 66999999999";
        const p = normalizeBrazilToE164(v);
        return `Vai salvar como: ${p}`;
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

        const threadChannel = String(selectedThread.channel ?? "whatsapp").toLowerCase();
        const isMetaThread = threadChannel === "instagram" || threadChannel === "messenger";

        if (isMetaThread) {
            if (attachment) {
                setErr("Anexos pela inbox ainda não estão disponíveis no Instagram/Messenger.");
                return;
            }
            if (!selectedThread.external_id && !selectedThread.phone_e164) {
                setErr("Thread sem destinatário Meta (external_id).");
                return;
            }

            const optimisticId = `opt_${Date.now()}`;
            const optimisticMsg: Message = {
                id:         optimisticId,
                direction:  "outbound",
                provider:   null,
                from_addr:  null,
                to_addr:    selectedThread.external_id ?? selectedThread.phone_e164,
                body:       text,
                status:     "sending",
                created_at: new Date().toISOString(),
                sender_type: "human",
            };
            setMessages((prev) => [...prev, optimisticMsg]);
            requestAnimationFrame(() => {
                const a = messagesAreaRef.current;
                if (a) a.scrollTo({ top: a.scrollHeight, behavior: "smooth" });
            });

            const res = await fetch("/api/meta/messaging/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ thread_id: selectedThread.id, text }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                const errMap: Record<string, string> = {
                    outside_service_window: "Fora da janela de atendimento da Meta.",
                    meta_channel_not_configured: "Conecte a Page em Configurações → Instagram/Messenger.",
                    missing_page_token: "Token da Page ausente. Reconecte o Instagram/Messenger.",
                };
                setErr(errMap[String(json?.error)] ?? json?.error ?? "Falha ao enviar no Meta");
                return;
            }
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === optimisticId
                        ? { ...m, status: "sent", provider: "meta", sender_type: "human" }
                        : m
                )
            );
            setErr(null);
            return;
        }

        if (!selectedThread.phone_e164) {
            setErr("Thread WhatsApp sem telefone.");
            return;
        }

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
            const a = messagesAreaRef.current;
            if (a) a.scrollTo({ top: a.scrollHeight, behavior: "smooth" });
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

    async function resetSession(threadId: string) {
        setResetSessionBusy(true);
        try {
            const res  = await fetch(`/api/whatsapp/threads/${threadId}/reset-session`, {
                method:  "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(json?.error ?? "Falha ao encerrar sessão"); return; }
            setResetSessionOpen(false);
            setResetSessionDone("Sessão encerrada e carrinho limpo.");
            setTimeout(() => setResetSessionDone(null), 4000);
        } catch { setErr("Falha ao encerrar sessão"); }
        finally   { setResetSessionBusy(false); }
    }

    async function createThread() {
        const name        = newName.trim();
        const phoneE164 = normalizeBrazilToE164(newPhoneBR);
        setCreatingThread(true);
        setErr(null);
        try {
            const res  = await fetch("/api/whatsapp/threads/create", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ phone_e164: phoneE164, profile_name: name || undefined }),
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
        /**
         * `absolute inset-0` (mesmo padrão do PDV em `app/(admin)/pdv/page.tsx`) escapa do
         * wrapper padded do `AdminShell` (`main > div.px-*.py-*`), que soma altura extra e
         * fazia a página inteira rolar (cortando a caixa de digitar mensagem no fundo) em vez
         * de só a lista de mensagens rolar internamente. Ancora relativo ao `<main>` (o único
         * ancestor com `position: relative`), preenchendo exatamente o espaço disponível.
         */
        <div className="absolute inset-0 flex gap-3 overflow-hidden p-3 md:p-4">

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
                            const displayIn = {
                                channel: t.channel,
                                profileName: t.profile_name,
                                phoneE164: t.phone_e164,
                                externalId: t.external_id,
                            };
                            const label     = threadDisplayName(displayIn);
                            const subtitle  = t.last_message_preview || threadDisplaySubtitle(displayIn);
                            const initials  = getInitials(label);
                            const nearClose = isCustomerServiceWindowClosing(t.last_inbound_at);
                            const expired   = !isWithinCustomerServiceWindow(t.last_inbound_at);
                            const badge     = channelBadgeLabel(t.channel);

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
                                                    <span className="mr-1 rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                                        {badge}
                                                    </span>
                                                    {label}
                                                </span>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {nearClose && <Clock className="h-3 w-3 text-orange-500" aria-label="Janela prestes a fechar" />}
                                                    {expired   && <Clock className="h-3 w-3 text-zinc-400"   aria-label="Janela de 24h expirada" />}
                                                    <span className="text-[10px] text-zinc-400">{timeAgo(t.last_message_at)}</span>
                                                </div>
                                            </div>
                                            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                                {subtitle}
                                            </p>
                                            {(t.bot_active === false || t.cart_summary) && (
                                                <div className="mt-0.5 flex items-center gap-1">
                                                    {t.bot_active === false && (
                                                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                                                            🤝 Humano
                                                        </span>
                                                    )}
                                                    {t.cart_summary && (
                                                        <span
                                                            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                                                t.cart_summary.total >= HIGH_VALUE_CART_THRESHOLD
                                                                    ? "bg-orange-100 text-orange-700"
                                                                    : "bg-primary/10 text-primary"
                                                            }`}
                                                            title={`${t.cart_summary.itemCount} itens no carrinho — R$ ${formatBRL(t.cart_summary.total)}`}
                                                        >
                                                            🛒 R$ {formatBRL(t.cart_summary.total)}
                                                        </span>
                                                    )}
                                                </div>
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
                                    {getInitials(
                                        threadDisplayName({
                                            channel: selectedThread.channel,
                                            profileName: selectedThread.profile_name,
                                            phoneE164: selectedThread.phone_e164,
                                            externalId: selectedThread.external_id,
                                        })
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                        <span className="mr-1.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                            {channelBadgeLabel(selectedThread.channel)}
                                        </span>
                                        {threadDisplayName({
                                            channel: selectedThread.channel,
                                            profileName: selectedThread.profile_name,
                                            phoneE164: selectedThread.phone_e164,
                                            externalId: selectedThread.external_id,
                                        })}
                                    </p>
                                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        {threadDisplaySubtitle({
                                            channel: selectedThread.channel,
                                            profileName: selectedThread.profile_name,
                                            phoneE164: selectedThread.phone_e164,
                                            externalId: selectedThread.external_id,
                                        })}
                                    </p>
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

                                {/* Encerrar sessão + limpar carrinho */}
                                <button
                                    onClick={() => setResetSessionOpen(true)}
                                    aria-label="Encerrar sessão e limpar carrinho"
                                    title="Encerrar sessão e limpar carrinho"
                                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-primary/40 dark:hover:bg-zinc-800"
                                >
                                    <Eraser className="h-4 w-4" />
                                </button>

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
                                const isBot     = m.sender_type === "bot";
                                const isSending = m.id.startsWith("opt_");
                                const rawMedia = extractMediaFromWaPayload(m.raw_payload ?? null);
                                const safeRawMediaId = rawMedia ? sanitizeWhatsAppMediaPathId(rawMedia.id) : null;
                                const hasRawMedia = Boolean(rawMedia && safeRawMediaId);
                                const bodyMedia = !hasRawMedia ? detectBodyMedia(m.body, waMediaChannelUuid) : null;
                                const displayText = bodyMedia ? null : m.body;
                                const waPayloadMediaPath =
                                    hasRawMedia && rawMedia && safeRawMediaId
                                        ? buildWaMediaRelativePath(rawMedia.id, waMediaChannelUuid)
                                        : null;

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
                                            {hasRawMedia && rawMedia && safeRawMediaId && waPayloadMediaPath ? (
                                                <div className="mb-2">
                                                    {rawMedia.type === "image" ? (
                                                        <img
                                                            src={waPayloadMediaPath}
                                                            alt={rawMedia.caption || "Imagem"}
                                                            loading="lazy"
                                                            className="max-h-60 max-w-full rounded-xl object-cover"
                                                        />
                                                    ) : rawMedia.type === "video" ? (
                                                        <video controls src={waPayloadMediaPath} className="max-h-52 max-w-full rounded-xl" />
                                                    ) : rawMedia.type === "audio" ? (
                                                        <audio controls src={waPayloadMediaPath} className="w-52" />
                                                    ) : (
                                                        <a
                                                            href={waPayloadMediaPath}
                                                            target="_blank" rel="noreferrer"
                                                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold underline ${isOut ? "text-white/90" : "text-primary"}`}
                                                        >
                                                            <File className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                            Abrir documento
                                                        </a>
                                                    )}
                                                </div>
                                            ) : rawMedia && !safeRawMediaId ? (
                                                <p className={`mb-2 text-xs ${isOut ? "text-white/70" : "text-zinc-500"}`}>Mídia indisponível (identificador inválido).</p>
                                            ) : null}

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

                                            {/* Hora + status + remetente */}
                                            <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${isOut ? "justify-end text-white/60" : "text-zinc-400"}`}>
                                                {isBot && (
                                                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold">
                                                        🤖 Bot
                                                    </span>
                                                )}
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
                {selectedThread &&
                    String(selectedThread.channel ?? "whatsapp").toLowerCase() === "whatsapp" && (
                    <TemplateQuickSend
                        disabled={!selectedThread.phone_e164}
                        phoneE164={selectedThread.phone_e164}
                        onSent={async () => {
                            if (!selectedThreadId) return;
                            await loadMessages(selectedThreadId);
                            await loadThreads(selectedThreadId);
                        }}
                    />
                )}
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
                    cart={activeCart}
                    cartLoading={loadingCart}
                    handover={handoverInfo}
                    cartCopied={cartCopied}
                    onCopyCartSummary={copyCartSummary}
                    onOpenCartEditor={() => setCartModalOpen(true)}
                    pendingConfirmation={pendingConfirmation}
                    onCancelConfirmation={cancelPendingConfirmation}
                    cancelingConfirmation={cancelingConfirmation}
                    onViewOrder={(id) => setViewOrderId(id)}
                />
            )}

            {/* ── MODAL: montar/editar carrinho (produtos, endereço, pagamento) ── */}
            {selectedThreadId && (
                <CartEditModal
                    open={cartModalOpen}
                    onClose={() => setCartModalOpen(false)}
                    threadId={selectedThreadId}
                    customerName={customerProfile?.name || selectedThread?.profile_name || null}
                    customerPhone={selectedThread?.phone_e164 ?? null}
                    initialCart={activeCart}
                    onSent={() => { setCartModalOpen(false); loadActiveCart(selectedThreadId); }}
                />
            )}

            {/* ── MODAL: detalhe read-only de pedido antigo (deep link) ──── */}
            <OrderSummaryModal
                open={!!viewOrderId}
                onClose={() => setViewOrderId(null)}
                orderId={viewOrderId}
            />

            {/* ── MODAL: limite billing ──────────────────────────────────── */}
            {limitOpen && (
                <BillingModal
                    usage={limitUsage}
                    pendingText={pendingText}
                    busy={billingBusy}
                    onClose={() => { if (!billingBusy) setLimitOpen(false); }}
                    onAcceptOverage={acceptOverageAndRetry}
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

            {/* ── MODAL: encerrar sessão / limpar carrinho ───────────────── */}
            {resetSessionOpen && selectedThread && (
                <InlineModal
                    title="Encerrar sessão do cliente?"
                    onClose={() => { if (!resetSessionBusy) setResetSessionOpen(false); }}
                >
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Isso vai zerar o carrinho e o histórico da conversa com o bot. O cliente
                        pode começar um pedido novo do zero na próxima mensagem. O bot continua
                        ativo/pausado como está agora.
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            onClick={() => setResetSessionOpen(false)}
                            disabled={resetSessionBusy}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => resetSession(selectedThread.id)}
                            disabled={resetSessionBusy}
                            className="rounded-lg bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                        >
                            {resetSessionBusy ? "Encerrando..." : "Encerrar sessão"}
                        </button>
                    </div>
                </InlineModal>
            )}

            {/* ── Toast: sessão encerrada ─────────────────────────────────── */}
            {resetSessionDone && (
                <div
                    role="status"
                    className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:bg-zinc-700"
                >
                    {resetSessionDone}
                </div>
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
    cart,
    cartLoading,
    handover,
    cartCopied,
    onCopyCartSummary,
    onOpenCartEditor,
    pendingConfirmation,
    onCancelConfirmation,
    cancelingConfirmation,
    onViewOrder,
}: {
    thread: Thread;
    profile: CustomerProfile | null;
    loading: boolean;
    onClose: () => void;
    onRepeatOrder: () => void;
    cart: ActiveCart | null;
    cartLoading: boolean;
    handover: ThreadHandoverInfo | null;
    cartCopied: boolean;
    onCopyCartSummary: () => void;
    onOpenCartEditor: () => void;
    pendingConfirmation: PendingOrderConfirmation | null;
    onCancelConfirmation: () => void;
    cancelingConfirmation: boolean;
    onViewOrder: (orderId: string) => void;
}) {
    const displayIn = {
        channel: thread.channel,
        profileName: profile?.name || thread.profile_name,
        phoneE164: thread.phone_e164,
        externalId: thread.external_id,
    };
    const name     = threadDisplayName(displayIn);
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
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {channelBadgeLabel(thread.channel)} · {threadDisplaySubtitle(displayIn)}
                    </p>
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
                {/* Atendimento humano: motivo do handover */}
                {thread.bot_active === false && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300">
                        <p className="font-semibold">Em atendimento humano</p>
                        {handover?.reason && <p className="mt-0.5">{handover.reason}</p>}
                        {(handover?.since || thread.handover_at) && (
                            <p className="mt-0.5 text-amber-600/80 dark:text-amber-400/70">
                                há {timeAgo(handover?.since ?? thread.handover_at)}
                            </p>
                        )}
                    </div>
                )}

                {/* ── Seção 1: Carrinho atual (solicitação pendente ou preview + editor) ── */}
                {cartLoading ? (
                    <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
                ) : pendingConfirmation ? (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-800/60 dark:bg-blue-900/15">
                        <div className="mb-1 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                            <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Aguardando confirmação do cliente</p>
                        </div>
                        <p className="whitespace-pre-wrap text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-4">{pendingConfirmation.summaryText}</p>
                        <p className="mt-1 text-[10px] text-zinc-400">enviado há {timeAgo(pendingConfirmation.createdAt)}</p>
                        <button
                            onClick={onCancelConfirmation}
                            disabled={cancelingConfirmation}
                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 px-2 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/30"
                        >
                            {cancelingConfirmation ? "Cancelando..." : "Cancelar solicitação"}
                        </button>
                    </div>
                ) : (
                    <div
                        className={`rounded-xl border px-3 py-2.5 ${
                            cart && cart.grandTotal >= HIGH_VALUE_CART_THRESHOLD
                                ? "border-orange-200 bg-orange-50 dark:border-orange-800/60 dark:bg-orange-900/15"
                                : "border-zinc-100 dark:border-zinc-800"
                        }`}
                    >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                                <ShoppingCart className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                                    {cart ? (cart.source === "live_session" ? "Carrinho atual" : "Carrinho abandonado") : "Carrinho"}
                                </p>
                            </div>
                            {cart && <span className="text-[10px] text-zinc-400">{cart.stepLabel}</span>}
                        </div>

                        {cart && cart.items.length > 0 ? (
                            <>
                                <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                                    {cart.items.map((it) => (
                                        <div key={it.produtoEmbalagemId} className="flex items-center justify-between gap-1.5 py-1">
                                            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-300">
                                                {it.quantity}x {it.productName}{it.sigla && it.sigla !== "UN" ? ` (${it.sigla})` : ""}
                                            </span>
                                            <span className="shrink-0 text-right text-[10px] font-semibold text-zinc-500">R$ {formatBRL(it.subtotal)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-1.5 flex items-center justify-between border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
                                    <span className="text-[11px] text-zinc-500">
                                        {cart.totalItems} {cart.totalItems === 1 ? "item" : "itens"}
                                    </span>
                                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">R$ {formatBRL(cart.grandTotal)}</span>
                                </div>
                                {(cart.address || cart.paymentMethod) && (
                                    <div className="mt-1.5 space-y-1 border-t border-zinc-100 pt-1.5 text-[10px] text-zinc-500 dark:border-zinc-800">
                                        {cart.address && (
                                            <p className="flex items-start gap-1">
                                                <MapPin className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                                                <span className="truncate">
                                                    {[cart.address.logradouro, cart.address.numero, cart.address.bairro].filter(Boolean).join(", ")}
                                                </span>
                                            </p>
                                        )}
                                        {cart.paymentMethod && (
                                            <p className="flex items-center gap-1">
                                                <Wallet className="h-3 w-3 shrink-0" aria-hidden="true" />
                                                {paymentLabel(cart.paymentMethod)}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-[11px] text-zinc-400">Nenhum carrinho ativo agora.</p>
                        )}

                        <div className="mt-2 flex gap-1.5">
                            <button
                                onClick={onOpenCartEditor}
                                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-primary/90 transition-colors"
                            >
                                <ShoppingCart className="h-3 w-3" aria-hidden="true" />
                                {cart && cart.items.length > 0 ? "Editar carrinho" : "Montar carrinho"}
                            </button>
                            {cart && cart.items.length > 0 && (
                                <button
                                    onClick={onCopyCartSummary}
                                    title="Copiar resumo do carrinho"
                                    className="flex items-center justify-center gap-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                >
                                    {cartCopied ? <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                                </button>
                            )}
                        </div>
                    </div>
                )}

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

                        {/* ── Seção 2: Últimos pedidos (deep link pro detalhe) ── */}
                        {profile.orders.length > 0 ? (
                            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800">
                                <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                                    <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Últimos pedidos</p>
                                </div>
                                <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                                    {profile.orders.slice(0, 5).map((o) => (
                                        <button
                                            key={o.id}
                                            onClick={() => onViewOrder(o.id)}
                                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${statusColor(o.status)}`}>
                                                        {statusLabel(o.status)}
                                                    </span>
                                                    <span className="text-[10px] text-zinc-400">{formatDateShort(o.created_at)}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                                                    {o.items.slice(0, 2).map((it) => it.product_name).join(", ")}
                                                    {o.items.length > 2 ? ` +${o.items.length - 2}` : ""}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <span className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50">R$ {formatBRL(o.total_amount)}</span>
                                                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                            </div>
                                        </button>
                                    ))}
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

// ─── TemplateQuickSend ────────────────────────────────────────────────────────

function TemplateQuickSend({
    disabled,
    phoneE164,
    onSent,
}: {
    disabled: boolean;
    phoneE164: string | null;
    onSent: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [templates, setTemplates] = useState<
        Array<{ id: string; name: string; language: string; status: string }>
    >([]);
    const [selected, setSelected] = useState("");
    const [param1, setParam1] = useState("");
    const [param2, setParam2] = useState("");
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setErr(null);
        void fetch("/api/admin/whatsapp-templates", { credentials: "include", cache: "no-store" })
            .then(async (res) => {
                const json = (await res.json().catch(() => ({}))) as {
                    templates?: Array<{ id: string; name: string; language: string; status: string }>;
                    error?: string;
                    hint?: string;
                };
                if (cancelled) return;
                if (!res.ok) {
                    setErr(json.hint || json.error || "Templates indisponíveis neste plano.");
                    setTemplates([]);
                    return;
                }
                const approved = (json.templates ?? []).filter((t) => t.status === "APPROVED");
                setTemplates(approved);
                if (approved[0]) setSelected(`${approved[0].name}::${approved[0].language}`);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    async function send() {
        if (!phoneE164 || !selected) return;
        const [name, language] = selected.split("::");
        setSending(true);
        setErr(null);
        try {
            const params = [param1, param2].map((p) => p.trim()).filter(Boolean);
            const res = await fetch("/api/whatsapp/send", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to_phone_e164: phoneE164,
                    kind: "template",
                    template_name: name,
                    template_language: language || "pt_BR",
                    template_body_params: params.length ? params : undefined,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
            if (!res.ok) {
                setErr(json.hint || json.error || "Falha ao enviar template.");
                return;
            }
            setOpen(false);
            await onSent();
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
            {!open ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen(true)}
                    className="text-xs font-medium text-violet-600 hover:underline disabled:opacity-40 dark:text-violet-400"
                >
                    Enviar template (HSM)
                </button>
            ) : (
                <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
                    {loading ? (
                        <p className="text-xs text-zinc-500">Carregando templates…</p>
                    ) : templates.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                            Nenhum template APPROVED. Crie em{" "}
                            <a href="/templates" className="underline">
                                Templates WA
                            </a>
                            .
                        </p>
                    ) : (
                        <>
                            <select
                                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                                value={selected}
                                onChange={(e) => setSelected(e.target.value)}
                            >
                                {templates.map((t) => (
                                    <option key={t.id} value={`${t.name}::${t.language}`}>
                                        {t.name} ({t.language})
                                    </option>
                                ))}
                            </select>
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                                    placeholder="{{1}}"
                                    value={param1}
                                    onChange={(e) => setParam1(e.target.value)}
                                />
                                <input
                                    className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                                    placeholder="{{2}}"
                                    value={param2}
                                    onChange={(e) => setParam2(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={sending || !selected}
                                    onClick={() => void send()}
                                    className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                                >
                                    {sending ? "Enviando…" : "Enviar template"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="rounded-md px-2.5 py-1 text-xs text-zinc-600"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </>
                    )}
                    {err && <p className="text-xs text-red-600">{err}</p>}
                </div>
            )}
        </div>
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
