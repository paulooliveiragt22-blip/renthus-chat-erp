// app/(admin)/impressoras/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import PlanFeatureGate from "@/components/billing/PlanFeatureGate";
import { loadAdminListSnapshotEntries } from "@/lib/offline/browserStores";
import {
    DEFAULT_AUTO_PRINT_COPIES,
    PRINT_COPY_TYPES,
    normalizePrintCopyTypes,
    printCopyLabel,
    type PrintCopyType,
} from "@/lib/print/copyTypes";

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
    copy_type?: string;
    total_amount: number | null;
    customer_name: string | null;
};

type PrintSettings = {
    print_header: string;
    print_footer: string;
    auto_print: boolean;
    print_on_receive: boolean;
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
    const { currentCompanyId: companyId } = useWorkspace();

    // ── agent state ───────────────────────────────────────────────────────────
    const [agents,       setAgents]       = useState<AgentRow[]>([]);
    const [newApiKey,    setNewApiKey]    = useState<string | null>(null);
    const [pairingCode,  setPairingCode]  = useState<string | null>(null);
    const [pairingExpires, setPairingExpires] = useState<string | null>(null);
    const [generating,   setGenerating]   = useState(false);
    const [pairingBusy,  setPairingBusy]  = useState(false);
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
        print_on_receive: true, hide_prices_kitchen: false,
    });
    const [autoCopies, setAutoCopies] = useState<PrintCopyType[]>([...DEFAULT_AUTO_PRINT_COPIES]);
    const [clearingQueue, setClearingQueue] = useState(false);
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
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        if (offline && companyId) {
            const cached = await loadAdminListSnapshotEntries<AgentRow>(companyId, "printers");
            setAgents(cached);
            return;
        }
        try {
            const res = await fetch("/api/agent/keys", { credentials: "include", cache: "no-store" });
            if (res.ok) {
                setAgents((await res.json()).agents ?? []);
                return;
            }
            if (companyId) {
                const cached = await loadAdminListSnapshotEntries<AgentRow>(companyId, "printers");
                if (cached.length > 0) setAgents(cached);
            }
        } catch {
            if (companyId) {
                const cached = await loadAdminListSnapshotEntries<AgentRow>(companyId, "printers");
                setAgents(cached);
            }
        }
    }, [companyId]);

    // Fila agregada no servidor a partir de print_jobs + orders.
    const loadJobs = useCallback(async () => {
        if (!companyId) return;
        setLoadingJobs(true);
        const res = await fetch("/api/admin/impressoras/jobs", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (res.ok) setJobs((json.jobs ?? []) as PrintJob[]);
        setLoadingJobs(false);
    }, [companyId]);

    const loadSettings = useCallback(async () => {
        setLoadingSettings(true);
        const [agentRes, companyRes] = await Promise.all([
            fetch("/api/agent/settings", { credentials: "include", cache: "no-store" }),
            fetch("/api/admin/company-settings", { credentials: "include", cache: "no-store" }),
        ]);
        if (agentRes.ok) {
            const json = await agentRes.json();
            if (json.settings && typeof json.settings === "object") {
                setSettings((prev) => ({
                    ...prev,
                    print_header: String(json.settings.print_header ?? prev.print_header),
                    print_footer: String(json.settings.print_footer ?? prev.print_footer),
                    auto_print: Boolean(json.settings.auto_print ?? prev.auto_print),
                    print_on_receive: Boolean(json.settings.print_on_receive ?? prev.print_on_receive),
                    hide_prices_kitchen: Boolean(
                        json.settings.hide_prices_kitchen ?? prev.hide_prices_kitchen
                    ),
                }));
            }
        }
        if (companyRes.ok) {
            const json = await companyRes.json();
            const copies = normalizePrintCopyTypes(json?.settings?.print_auto_copies);
            setAutoCopies(copies.length > 0 ? copies : [...DEFAULT_AUTO_PRINT_COPIES]);
        }
        setLoadingSettings(false);
    }, []);

    useEffect(() => {
        if (!companyId) return;
        loadAgents();
        loadJobs();
        loadSettings();
    }, [companyId, loadAgents, loadJobs, loadSettings]);

    // ── polling leve para status online e jobs ────────────────────────────────
    useEffect(() => {
        if (!companyId) return;
        const id = setInterval(() => {
            void loadAgents();
            void loadJobs();
        }, 8000);
        return () => clearInterval(id);
    }, [companyId, loadAgents, loadJobs]);

    // ── agent key / pairing ───────────────────────────────────────────────────
    async function generateKey() {
        setGenerating(true); setAgentErr(null); setNewApiKey(null); setPairingCode(null);
        const res = await fetch("/api/agent/keys", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: "{}" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setAgentErr(json?.error ?? "Erro ao gerar chave"); }
        else { setNewApiKey(json.api_key); loadAgents(); }
        setGenerating(false);
    }

    async function generatePairing() {
        setPairingBusy(true);
        setAgentErr(null);
        setPairingCode(null);
        setNewApiKey(null);
        const res = await fetch("/api/admin/print-agents/pairing", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setAgentErr(
                json?.hint ??
                    json?.error ??
                    "Não foi possível gerar o código (plano Pro/Market com impressão automática)."
            );
        } else {
            setPairingCode(String(json.code ?? ""));
            setPairingExpires(json.expiresAt ? String(json.expiresAt) : null);
            void loadAgents();
        }
        setPairingBusy(false);
    }

    async function revokeAgent(id: string) {
        if (!confirm("Desativar este agente?")) return;
        await fetch("/api/agent/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ agent_id: id }) });
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
        const copy = normalizePrintCopyTypes([job.copy_type ?? "cashier"]);
        const res = await fetch("/api/agent/reprint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                order_id: job.order_id,
                copy_types: copy.length > 0 ? copy : ["cashier"],
            }),
        });
        const json = await res.json().catch(() => ({}));
        setReprintMsg(res.ok ? "✓ Job de reimpressão criado" : (json?.error ?? "Erro ao reimprimir"));
        setReprintingId(null);
        if (res.ok) { setTimeout(() => { setReprintMsg(null); loadJobs(); }, 3000); }
    }

    async function clearQueue() {
        if (!confirm("Limpar a fila? Cancela jobs pendentes e processing sem resposta (não apaga histórico).")) return;
        setClearingQueue(true);
        setReprintMsg(null);
        const res = await fetch("/api/admin/impressoras/clear-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: "{}",
        });
        const json = await res.json().catch(() => ({}));
        setClearingQueue(false);
        if (!res.ok) {
            setReprintMsg(json?.error ?? "Erro ao limpar fila");
            return;
        }
        const pending = Number(json.canceled_pending ?? 0);
        const stale = Number(json.canceled_stale_processing ?? 0);
        setReprintMsg(`✓ Fila limpa: ${pending} pendente(s), ${stale} travado(s)`);
        void loadJobs();
        setTimeout(() => setReprintMsg(null), 4000);
    }

    // ── settings save ─────────────────────────────────────────────────────────
    async function saveSettings() {
        setSavingSettings(true); setSettingsMsg(null);
        const [agentRes, companyRes] = await Promise.all([
            fetch("/api/agent/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(settings),
            }),
            fetch("/api/admin/company-settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ print_auto_copies: autoCopies }),
            }),
        ]);
        const agentJson = await agentRes.json().catch(() => ({}));
        const companyJson = await companyRes.json().catch(() => ({}));
        const ok = agentRes.ok && companyRes.ok;
        setSettingsMsg(
            ok
                ? "✓ Configurações salvas"
                : (companyJson?.error ?? agentJson?.error ?? "Erro ao salvar")
        );
        setSavingSettings(false);
        if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
        msgTimerRef.current = setTimeout(() => setSettingsMsg(null), 3000);
    }

    function setSetting<K extends keyof PrintSettings>(key: K, val: PrintSettings[K]) {
        setSettings((prev) => ({ ...prev, [key]: val }));
    }

    function toggleAutoCopy(copy: PrintCopyType) {
        setAutoCopies((prev) =>
            prev.includes(copy) ? prev.filter((c) => c !== copy) : [...prev, copy]
        );
    }

    // ── test print ────────────────────────────────────────────────────────────
    async function testPrint() {
        if (!companyId) return;
        setTestLoading(true); setTestMsg(null);
        const res = await fetch("/api/admin/impressoras/test-order", { method: "POST", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setTestMsg(`Erro: ${json?.error ?? "falha"}`); setTestLoading(false); return; }
        setTestMsg("Pedido de teste criado e enviado para a fila.");
        setTestLoading(false);
        setTimeout(() => { setTestMsg(null); loadJobs(); }, 5000);
    }

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <PlanFeatureGate
            featureKey="printing_auto"
            title="Impressão automática"
            description="Vínculo com o Renthus Print Agent, fila de cupons e automação de impressão."
            requiredPlanLabel="Pro ou Market"
        >
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
                                <p className="text-xs text-zinc-400">
                                    Pareie com um código curto ou gere a chave manualmente
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    void generatePairing();
                                }}
                                disabled={pairingBusy}
                                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                            >
                                {pairingBusy ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Wifi className="h-3 w-3" />
                                )}
                                {pairingBusy ? "Gerando…" : "Código de pareamento"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void generateKey();
                                }}
                                disabled={generating}
                                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                            >
                                {generating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <KeyRound className="h-3 w-3" />
                                )}
                                {generating ? "Gerando…" : "Nova chave"}
                            </button>
                        </div>
                    </div>

                    {/* Error */}
                    {agentErr && (
                        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                            <span>{agentErr}</span>
                            <button onClick={() => setAgentErr(null)}><XCircle className="h-4 w-4" /></button>
                        </div>
                    )}

                    {pairingCode && (
                        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-700/40 dark:bg-violet-900/20">
                            <p className="mb-2 text-xs font-bold text-violet-800 dark:text-violet-300">
                                Código de pareamento (use uma vez no Print Agent):
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 tracking-[0.2em] rounded bg-white px-3 py-2 text-center font-mono text-lg font-bold text-violet-900 shadow-sm dark:bg-zinc-800 dark:text-violet-200">
                                    {pairingCode}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => copyKey(pairingCode)}
                                    className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                                >
                                    {copied ? (
                                        <CheckCircle2 className="h-3 w-3" />
                                    ) : (
                                        <ClipboardCopy className="h-3 w-3" />
                                    )}
                                    {copied ? "Copiado" : "Copiar"}
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                                URL:{" "}
                                <strong>
                                    {typeof window !== "undefined" ? window.location.origin : ""}
                                </strong>
                                {pairingExpires
                                    ? ` · expira ${new Date(pairingExpires).toLocaleTimeString("pt-BR", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                      })}`
                                    : " · válido por ~15 min"}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500">
                                O agente chama{" "}
                                <code className="font-mono">POST /api/agent/activate</code> com este
                                código e recebe a API key.
                            </p>
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
                                    type="button"
                                    onClick={() => copyKey(newApiKey)}
                                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                    {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {copied ? "Copiado" : "Copiar"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNewApiKey(null)}
                                    className="rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300"
                                >
                                    OK
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-500">
                                URL do servidor:{" "}
                                <strong>
                                    {typeof window !== "undefined" ? window.location.origin : ""}
                                </strong>
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
                            href={
                                process.env.NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL ||
                                "https://github.com/paulooliveiragt22-blip/renthus-chat-erp/releases/download/print-agent-v1.1.3/renthus-print-agent-1.1.3-win.zip"
                            }
                            target="_blank"
                            rel="noopener noreferrer"
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
                                <p className="text-xs text-zinc-400">Últimos jobs enviados ao agente</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => void clearQueue()}
                                disabled={clearingQueue}
                                className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                            >
                                {clearingQueue ? "Limpando…" : "Limpar fila"}
                            </button>
                            <button
                                onClick={loadJobs}
                                className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                        </div>
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
                                            <span>
                                                {job.copy_type
                                                    ? printCopyLabel(
                                                          normalizePrintCopyTypes([job.copy_type])[0] ??
                                                              "cashier"
                                                      )
                                                    : "Caixa"}
                                            </span>
                                            <span>·</span>
                                            <span>{new Date(job.printed_at).toLocaleString("pt-BR")}</span>
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
                                <div className="flex items-center justify-between gap-4 py-4">
                                    <div className="flex items-start gap-3">
                                        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                                        <div>
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                Imprimir ao receber pedido
                                            </p>
                                            <p className="mt-0.5 text-xs text-zinc-400">
                                                Envia para impressão automaticamente quando um novo pedido chegar no ERP.
                                            </p>
                                        </div>
                                    </div>
                                    <Toggle
                                        checked={settings.print_on_receive}
                                        onChange={(v) => setSettings((prev) => ({ ...prev, print_on_receive: v }))}
                                    />
                                </div>
                                <div className="py-4">
                                    <div className="flex items-start gap-3">
                                        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                Vias no auto-print
                                            </p>
                                            <p className="mt-0.5 text-xs text-zinc-400">
                                                Escolha quais cupons entram na fila ao confirmar o pedido. Via entregador só em pedidos de entrega.
                                            </p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {PRINT_COPY_TYPES.map((copy) => {
                                                    const on = autoCopies.includes(copy);
                                                    return (
                                                        <button
                                                            key={copy}
                                                            type="button"
                                                            onClick={() => toggleAutoCopy(copy)}
                                                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                                                on
                                                                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                                                    : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700"
                                                            }`}
                                                        >
                                                            {printCopyLabel(copy)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-4 py-4">
                                    <div className="flex items-start gap-3">
                                        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                                        <div>
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                Ocultar preços no cupom da cozinha
                                            </p>
                                            <p className="mt-0.5 text-xs text-zinc-400">
                                                Remove os valores dos itens no cupom enviado para a cozinha/bar.
                                            </p>
                                        </div>
                                    </div>
                                    <Toggle
                                        checked={settings.hide_prices_kitchen}
                                        onChange={(v) => setSettings((prev) => ({ ...prev, hide_prices_kitchen: v }))}
                                    />
                                </div>
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
                            className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-primary transition hover:bg-orange-600 disabled:opacity-60"
                        >
                            {savingSettings ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                            {savingSettings ? "Salvando…" : "Salvar Automação"}
                        </button>
                    </div>
                </div>
            </div>

        </div>
        </PlanFeatureGate>
    );
}
