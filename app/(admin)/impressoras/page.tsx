// app/(admin)/impressoras/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    CheckCircle2,
    ChevronRight,
    ClipboardCopy,
    Copy,
    Download,
    FileText,
    KeyRound,
    Loader2,
    Printer,
    RefreshCw,
    Settings2,
    ShieldAlert,
    Wifi,
    WifiOff,
    XCircle,
    Zap,
} from "lucide-react";

// ─── types ───────────────────────────────────────────────────────────────────

type AgentRow = {
    id: string;
    name: string;
    api_key_prefix: string;
    is_active: boolean;
    last_seen: string | null;
    created_at: string;
};

type PrintJob = {
    id: string;          // order id
    order_id: string;
    printed_at: string;
    status: string;
    total_amount: number | null;
    customer_name: string | null;
};

type PrintSettings = {
    print_header: string;
    print_footer: string;
    auto_print: boolean;
    print_on_receive: boolean;
    print_delivery_copy: boolean;
    hide_prices_kitchen: boolean;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function isOnline(lastSeen: string | null): boolean {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 3 * 60 * 1000; // 3 min
}

function timeAgo(iso: string | null): string {
    if (!iso) return "nunca";
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `há ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h / 24)}d`;
}

function formatBRL(v: number | null | undefined): string {
    return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const JOB_STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending:    { label: "Aguardando",   cls: "bg-blue-50  text-blue-700  border-blue-200",   icon: <Loader2  className="h-3 w-3 animate-spin" /> },
    processing: { label: "Imprimindo",   cls: "bg-amber-50 text-amber-700 border-amber-200",  icon: <Printer  className="h-3 w-3" /> },
    done:       { label: "Impresso",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
    completed:  { label: "Impresso",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed:     { label: "Falhou",       cls: "bg-red-50   text-red-700   border-red-200",    icon: <XCircle  className="h-3 w-3" /> },
    canceled:   { label: "Cancelado",    cls: "bg-zinc-100 text-zinc-500  border-zinc-200",   icon: <XCircle  className="h-3 w-3" /> },
};

function JobBadge({ status }: { status: string }) {
    const s = JOB_STATUS[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-500 border-zinc-200", icon: null };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
            {s.icon}{s.label}
        </span>
    );
}

// ─── switch component ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"
            }`}
        >
            <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                    checked ? "translate-x-5" : "translate-x-0"
                }`}
            />
        </button>
    );
}

// ─── skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-700 ${className}`} />;
}

// ─── main component ───────────────────────────────────────────────────────────

export default function ImpressorasPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId: companyId } = useWorkspace();

    // ── agent state ───────────────────────────────────────────────────────────
    const [agents,       setAgents]       = useState<AgentRow[]>([]);
    const [newApiKey,    setNewApiKey]    = useState<string | null>(null);
    const [generating,   setGenerating]   = useState(false);
    const [agentErr,     setAgentErr]     = useState<string | null>(null);
    const [copied,       setCopied]       = useState(false);

    // ── print jobs state ──────────────────────────────────────────────────────
    const [jobs,         setJobs]         = useState<PrintJob[]>([]);
    const [loadingJobs,  setLoadingJobs]  = useState(true);
    const [reprintingId, setReprintingId] = useState<string | null>(null);
    const [reprintMsg,   setReprintMsg]   = useState<string | null>(null);

    // ── settings state ────────────────────────────────────────────────────────
    const [settings,     setSettings]     = useState<PrintSettings>({
        print_header: "", print_footer: "", auto_print: true,
        print_on_receive: true, print_delivery_copy: false, hide_prices_kitchen: false,
    });
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [savingSettings,  setSavingSettings]  = useState(false);
    const [settingsMsg,     setSettingsMsg]      = useState<string | null>(null);

    // ── test print ────────────────────────────────────────────────────────────
    const [testLoading, setTestLoading] = useState(false);
    const [testMsg,     setTestMsg]     = useState<string | null>(null);

    // ── realtime ref ──────────────────────────────────────────────────────────
    const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── online status (derived from active agent last_seen) ───────────────────
    const activeAgent = useMemo(
        () => agents.find((a) => a.is_active) ?? agents[0] ?? null,
        [agents]
    );
    const online = isOnline(activeAgent?.last_seen ?? null);

    // ── data loaders ──────────────────────────────────────────────────────────
    const loadAgents = useCallback(async () => {
        const res = await fetch("/api/agent/keys");
        if (res.ok) setAgents((await res.json()).agents ?? []);
    }, []);

    // Usa orders.printed_at como fonte de verdade — é o campo que o agent preenche ao imprimir
    const loadJobs = useCallback(async () => {
        if (!companyId) return;
        setLoadingJobs(true);
        const { data } = await supabase
            .from("orders")
            .select("id, printed_at, status, total_amount, customers(name)")
            .eq("company_id", companyId)
            .not("printed_at", "is", null)
            .order("printed_at", { ascending: false })
            .limit(10);

        if (!data) { setLoadingJobs(false); return; }

        setJobs(data.map((o: any) => {
            const custName = Array.isArray(o.customers)
                ? o.customers[0]?.name ?? null
                : o.customers?.name ?? null;
            return {
                id:            o.id,
                order_id:      o.id,
                printed_at:    o.printed_at,
                status:        "done",
                total_amount:  o.total_amount != null ? Number(o.total_amount) : null,
                customer_name: custName,
            };
        }));
        setLoadingJobs(false);
    }, [companyId, supabase]);

    const loadSettings = useCallback(async () => {
        setLoadingSettings(true);
        const res = await fetch("/api/agent/settings");
        if (res.ok) {
            const json = await res.json();
            setSettings((prev) => ({ ...prev, ...(json.settings ?? {}) }));
        }
        setLoadingSettings(false);
    }, []);

    useEffect(() => {
        if (!companyId) return;
        loadAgents();
        loadJobs();
        loadSettings();
    }, [companyId, loadAgents, loadJobs, loadSettings]);

    // ── realtime: print_agents + print_jobs ───────────────────────────────────
    useEffect(() => {
        if (!companyId) return;
        const ch1 = supabase
            .channel("print_agents_realtime")
            .on("postgres_changes", { event: "*", schema: "public", table: "print_agents" }, () => loadAgents())
            .subscribe();
        const ch2 = supabase
            .channel("printed_orders_realtime")
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload: any) => {
                // Só recarrega se o evento tocou no campo printed_at
                if (payload?.new?.printed_at) loadJobs();
            })
            .subscribe();
        return () => {
            supabase.removeChannel(ch1);
            supabase.removeChannel(ch2);
        };
    }, [companyId, supabase, loadAgents, loadJobs]);

    // ── agent key management ──────────────────────────────────────────────────
    async function generateKey() {
        setGenerating(true); setAgentErr(null); setNewApiKey(null);
        const res = await fetch("/api/agent/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setAgentErr(json?.error ?? "Erro ao gerar chave"); }
        else { setNewApiKey(json.api_key); loadAgents(); }
        setGenerating(false);
    }

    async function revokeAgent(id: string) {
        if (!confirm("Desativar este agente?")) return;
        await fetch("/api/agent/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id }) });
        loadAgents();
    }

    function copyKey(key: string) {
        navigator.clipboard.writeText(key);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    // ── reprint ───────────────────────────────────────────────────────────────
    async function reprint(job: PrintJob) {
        if (!job.order_id) return;
        setReprintingId(job.id);
        setReprintMsg(null);
        const res = await fetch("/api/agent/reprint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: job.order_id }) });
        const json = await res.json().catch(() => ({}));
        setReprintMsg(res.ok ? "✓ Job de reimpressão criado" : (json?.error ?? "Erro ao reimprimir"));
        setReprintingId(null);
        if (res.ok) { setTimeout(() => { setReprintMsg(null); loadJobs(); }, 3000); }
    }

    // ── settings save ─────────────────────────────────────────────────────────
    async function saveSettings() {
        setSavingSettings(true); setSettingsMsg(null);
        const res = await fetch("/api/agent/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
        const json = await res.json().catch(() => ({}));
        setSettingsMsg(res.ok ? "✓ Configurações salvas" : (json?.error ?? "Erro ao salvar"));
        setSavingSettings(false);
        if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
        msgTimerRef.current = setTimeout(() => setSettingsMsg(null), 3000);
    }

    function setSetting<K extends keyof PrintSettings>(key: K, val: PrintSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: val }));
    }

    // ── test print ────────────────────────────────────────────────────────────
    async function testPrint() {
        if (!companyId) return;
        setTestLoading(true); setTestMsg(null);
        const { data: ord, error } = await supabase
            .from("orders")
            .insert([{ company_id: companyId, channel: "admin", status: "new", total_amount: 0 }])
            .select("id").single();
        if (error) { setTestMsg("Erro: " + error.message); setTestLoading(false); return; }
        await supabase.from("order_items").insert([{ order_id: ord.id, company_id: companyId, product_name: "Teste Cupom", quantity: 1, unit_price: 0 }]);
        setTestMsg("Pedido de teste criado. O agente deve imprimir em instantes.");
        setTestLoading(false);
        setTimeout(() => { setTestMsg(null); loadJobs(); }, 5000);
    }

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-6">

            {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Gestão de Impressão</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Renthus Print Agent · configurações e fila de impressão</p>
                </div>

                {/* agent status badge */}
                <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                    online
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                }`}>
                    {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    {online ? "Agente Online" : activeAgent ? "Agente Offline" : "Sem Agente"}
                    {activeAgent?.last_seen && (
                        <span className="text-xs font-normal opacity-70">{timeAgo(activeAgent.last_seen)}</span>
                    )}
                    {online && (
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                    )}
                </div>
            </div>

            {/* ── ROW 1: Agente + Fila ────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                {/* ── CARD: Vínculo com Agente ─────────────────────────────── */}
                <div className="flex flex-col gap-5 rounded-xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                                <KeyRound className="h-4 w-4 text-violet-600" />
                            </span>
                            <div>
                                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Vínculo com Agente</p>
                                <p className="text-xs text-zinc-400">Gere a chave e cole no Renthus Print Agent</p>
                            </div>
                        </div>
                        <button
                            onClick={generateKey}
                            disabled={generating}
                            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                        >
                            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                            {generating ? "Gerando…" : "Nova Chave"}
                        </button>
                    </div>

                    {/* Error */}
                    {agentErr && (
                        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                            <span>{agentErr}</span>
                            <button onClick={() => setAgentErr(null)}><XCircle className="h-4 w-4" /></button>
                        </div>
                    )}

                    {/* New key reveal */}
                    {newApiKey && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/40 dark:bg-emerald-900/20">
                            <p className="mb-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                ✓ Copie agora — não será exibida novamente:
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 overflow-hidden text-ellipsis rounded bg-white px-2.5 py-1.5 font-mono text-xs text-emerald-800 shadow-sm dark:bg-zinc-800 dark:text-emerald-300">
                                    {newApiKey}
                                </code>
                                <button
                                    onClick={() => copyKey(newApiKey)}
                                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                    {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {copied ? "Copiado" : "Copiar"}
                                </button>
                                <button onClick={() => setNewApiKey(null)} className="rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300">
                                    OK
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-500">
                                URL do servidor: <strong>{typeof window !== "undefined" ? window.location.origin : ""}</strong>
                            </p>
                        </div>
                    )}

                    {/* Agent list */}
                    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
                        {agents.length === 0
                            ? <p className="py-4 text-center text-sm text-zinc-400">Nenhum agente configurado.</p>
                            : agents.map((a) => (
                                <div key={a.id} className="flex items-center justify-between py-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{a.name}</span>
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                a.is_active && isOnline(a.last_seen)
                                                    ? "bg-emerald-100 text-emerald-700"
                                                    : a.is_active
                                                    ? "bg-amber-100 text-amber-700"
                                                    : "bg-zinc-100 text-zinc-500"
                                            }`}>
                                                {a.is_active && isOnline(a.last_seen) ? "● Online" : a.is_active ? "● Offline" : "Inativo"}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                                            <span className="font-mono">rpa_{a.api_key_prefix}…</span>
                                            {a.last_seen && <span>· {timeAgo(a.last_seen)}</span>}
                                        </div>
                                    </div>
                                    {a.is_active && (
                                        <button
                                            onClick={() => revokeAgent(a.id)}
                                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                        >
                                            Revogar
                                        </button>
                                    )}
                                </div>
                            ))}
                    </div>

                    {/* Test print + Download */}
                    <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button
                            onClick={testPrint}
                            disabled={testLoading}
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                            {testLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                            Pedido de Teste
                        </button>
                        <a
                            href="/api/downloads/print-agen"
                            download
                            className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-700/40 dark:bg-violet-900/20 dark:text-violet-300"
                        >
                            <Download className="h-3 w-3" />
                            Baixar Agente
                        </a>
                    </div>
                    {testMsg && <p className="text-xs text-zinc-500">{testMsg}</p>}
                </div>

                {/* ── CARD: Fila de Impressão ──────────────────────────────── */}
                <div className="flex flex-col gap-4 rounded-xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                                <Printer className="h-4 w-4 text-orange-500" />
                            </span>
                            <div>
                                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Fila de Impressão</p>
                                <p className="text-xs text-zinc-400">Últimos 10 jobs enviados ao agente</p>
                            </div>
                        </div>
                        <button
                            onClick={loadJobs}
                            className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {reprintMsg && (
                        <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                            reprintMsg.startsWith("✓")
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                        }`}>
                            {reprintMsg}
                        </div>
                    )}

                    <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 380 }}>
                        {loadingJobs
                            ? Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                    <Skeleton className="h-6 w-20 rounded-full" />
                                </div>
                            ))
                            : jobs.length === 0
                            ? (
                                <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-400">
                                    <FileText className="h-8 w-8 opacity-40" />
                                    <p className="text-sm">Nenhum job de impressão ainda.</p>
                                </div>
                            )
                            : jobs.map((job) => (
                                <div key={job.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50/50 px-3 py-2.5 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                {job.customer_name ?? `Job ${job.id.slice(-6).toUpperCase()}`}
                                            </span>
                                            {job.total_amount != null && (
                                                <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                                                    {formatBRL(job.total_amount)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                                            <span>Impresso {new Date(job.printed_at).toLocaleString("pt-BR")}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 ml-2 shrink-0">
                                        <JobBadge status={job.status} />
                                        {job.order_id && (
                                            <button
                                                onClick={() => reprint(job)}
                                                disabled={reprintingId === job.id}
                                                title="Reimprimir"
                                                className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50 dark:border-zinc-700"
                                            >
                                                {reprintingId === job.id
                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    : <RefreshCw className="h-3.5 w-3.5" />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            </div>

            {/* ── ROW 2: Preferências do Cupom + Automação ────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                {/* ── CARD: Preferências do Cupom ──────────────────────────── */}
                <div className="flex flex-col gap-5 rounded-xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <FileText className="h-4 w-4 text-blue-600" />
                        </span>
                        <div>
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Preferências do Cupom</p>
                            <p className="text-xs text-zinc-400">Texto do cabeçalho e rodapé do cupom térmico</p>
                        </div>
                    </div>

                    {loadingSettings
                        ? (
                            <div className="flex flex-col gap-3">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-20 w-full" />
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-20 w-full" />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        Cabeçalho do Cupom
                                    </label>
                                    <textarea
                                        value={settings.print_header}
                                        onChange={(e) => setSetting("print_header", e.target.value)}
                                        rows={3}
                                        placeholder={"Ex: Disk Bebidas Sorriso\nTel: (66) 9 9207-1285"}
                                        className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                                    />
                                    <p className="text-[11px] text-zinc-400">Aparece no topo de cada cupom. Cada linha é impressa centralizada.</p>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        Rodapé do Cupom
                                    </label>
                                    <textarea
                                        value={settings.print_footer}
                                        onChange={(e) => setSetting("print_footer", e.target.value)}
                                        rows={3}
                                        placeholder={"Ex: Obrigado pela preferência!\nVolte sempre :)"}
                                        className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                                    />
                                    <p className="text-[11px] text-zinc-400">Aparece no final do cupom, após a lista de itens.</p>
                                </div>
                            </div>
                        )}

                    {settingsMsg && (
                        <p className={`text-xs font-medium ${settingsMsg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>
                            {settingsMsg}
                        </p>
                    )}

                    <div className="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button
                            onClick={saveSettings}
                            disabled={savingSettings || loadingSettings}
                            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                        >
                            {savingSettings ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCopy className="h-3 w-3" />}
                            {savingSettings ? "Salvando…" : "Salvar Configurações"}
                        </button>
                    </div>
                </div>

                {/* ── CARD: Regras de Automação ────────────────────────────── */}
                <div className="flex flex-col gap-5 rounded-xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                            <Zap className="h-4 w-4 text-orange-500" />
                        </span>
                        <div>
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Regras de Automação</p>
                            <p className="text-xs text-zinc-400">Controle quando e como o agente imprime</p>
                        </div>
                    </div>

                    {loadingSettings
                        ? (
                            <div className="flex flex-col gap-5">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between">
                                        <div className="flex flex-col gap-1"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
                                        <Skeleton className="h-6 w-11 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
                                {[
                                    {
                                        key: "print_on_receive" as keyof PrintSettings,
                                        title: "Imprimir ao receber pedido",
                                        desc: "Envia para impressão automaticamente quando um novo pedido chegar no ERP.",
                                        accent: "text-violet-600",
                                    },
                                    {
                                        key: "print_delivery_copy" as keyof PrintSettings,
                                        title: "Imprimir via do entregador",
                                        desc: "Gera um segundo cupom simplificado (sem preços) para o entregador.",
                                        accent: "text-orange-500",
                                    },
                                    {
                                        key: "hide_prices_kitchen" as keyof PrintSettings,
                                        title: "Ocultar preços no cupom da cozinha",
                                        desc: "Remove os valores dos itens no cupom enviado para a cozinha/bar.",
                                        accent: "text-blue-500",
                                    },
                                ].map(({ key, title, desc, accent }) => (
                                    <div key={key} className="flex items-center justify-between gap-4 py-4">
                                        <div className="flex items-start gap-3">
                                            <Settings2 className={`mt-0.5 h-4 w-4 shrink-0 ${accent}`} />
                                            <div>
                                                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
                                                <p className="mt-0.5 text-xs text-zinc-400">{desc}</p>
                                            </div>
                                        </div>
                                        <Toggle
                                            checked={settings[key] as boolean}
                                            onChange={(v) => setSetting(key, v as PrintSettings[typeof key])}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-700/40 dark:bg-amber-900/20">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Alterações nas regras de automação são salvas ao clicar em <strong>Salvar Configurações</strong> no card ao lado.
                        </p>
                    </div>

                    <div className="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button
                            onClick={saveSettings}
                            disabled={savingSettings || loadingSettings}
                            className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                        >
                            {savingSettings ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                            {savingSettings ? "Salvando…" : "Salvar Automação"}
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
}
