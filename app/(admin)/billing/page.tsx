"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, MessageCircle, RefreshCcw, Sparkles, XCircle, Zap } from "lucide-react";

type Subscription = {
    subscription_id: string;
    plan_id: string;
    plan_key: string;
    plan_name: string | null;
    allow_overage: boolean;
} | null;

type WhatsAppUsage = {
    allowed: boolean;
    used: number;
    limit_per_month: number | null;
    will_overage_by: number;
};

type StatusResponse = {
    ok: true;
    subscription: Subscription;
    enabled_features: string[];
    usage: { whatsapp_messages: WhatsAppUsage };
};

const FEATURE_LABELS: Record<string, string> = {
    whatsapp_messages: "Mensagens WhatsApp",
    ai_parser:         "Parser com IA (Claude Haiku)",
    assisted_mode:     "Modo assistido",
    printing_auto:     "Impressão automática",
    pdv:               "Ponto de venda (PDV)",
};

const PLAN_PRICES: Record<string, string> = {
    starter: "R$ 297/mês",
    pro:     "R$ 397/mês",
};

export default function BillingPage() {
    const [status,  setStatus]  = useState<StatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);

    async function load() {
        setLoading(true); setError(null);
        try {
            const res  = await fetch("/api/billing/status", { credentials: "include", cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setError(json?.error ?? `Erro HTTP ${res.status}`); return; }
            setStatus(json as StatusResponse);
        } catch { setError("Falha de conexão"); }
        finally  { setLoading(false); }
    }

    useEffect(() => { load(); }, []);

    const sub  = status?.subscription ?? null;
    const wa   = status?.usage?.whatsapp_messages ?? null;
    const isPro = sub?.plan_key === "pro";

    const pct      = wa?.limit_per_month ? Math.min(100, Math.round((wa.used / wa.limit_per_month) * 100)) : 0;
    const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

    return (
        <div className="flex flex-col gap-6 max-w-2xl">
            {/* header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Plano & Uso</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">Acompanhe seu plano e consumo mensal</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                >
                    <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
                    ))}
                </div>
            ) : !status ? null : (
                <>
                    {/* ── card plano ─────────────────────────────────────── */}
                    <div className={`relative overflow-hidden rounded-2xl border p-6 shadow-sm ${
                        isPro
                            ? "border-violet-200 bg-gradient-to-br from-violet-50 to-white dark:border-violet-700/40 dark:from-violet-950/30 dark:to-zinc-900"
                            : "border-sky-200 bg-gradient-to-br from-sky-50 to-white dark:border-sky-700/40 dark:from-sky-950/30 dark:to-zinc-900"
                    }`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    {isPro
                                        ? <Zap className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                                        : <Sparkles className="h-5 w-5 text-sky-500 dark:text-sky-400" />}
                                    <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                                        {sub?.plan_name ?? sub?.plan_key ?? "Sem plano"}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                        isPro
                                            ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                                            : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                                    }`}>
                                        Ativo
                                    </span>
                                </div>
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                    {PLAN_PRICES[sub?.plan_key ?? ""] ?? ""}
                                </p>
                            </div>
                        </div>

                        {/* features */}
                        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {(status.enabled_features ?? []).map((f) => (
                                <div key={f} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                    {FEATURE_LABELS[f] ?? f}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── card WhatsApp uso ──────────────────────────────── */}
                    <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="flex items-center gap-3 mb-5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 dark:bg-green-500/10">
                                <MessageCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                            </span>
                            <div>
                                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Mensagens WhatsApp</p>
                                <p className="text-xs text-zinc-400">Consumo do mês atual</p>
                            </div>
                            <div className="ml-auto flex items-center gap-1.5">
                                {wa?.allowed
                                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    : <XCircle className="h-4 w-4 text-red-500" />}
                                <span className={`text-xs font-semibold ${wa?.allowed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                    {wa?.allowed ? "Envio liberado" : "Limite atingido"}
                                </span>
                            </div>
                        </div>

                        {wa ? (
                            <>
                                <div className="flex items-end justify-between mb-2">
                                    <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                                        {wa.used.toLocaleString("pt-BR")}
                                    </span>
                                    {wa.limit_per_month != null && (
                                        <span className="text-sm text-zinc-400">
                                            de {wa.limit_per_month.toLocaleString("pt-BR")} mensagens
                                        </span>
                                    )}
                                </div>

                                {wa.limit_per_month != null && (
                                    <>
                                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div
                                                className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                                            <span>{pct}% utilizado</span>
                                            <span>
                                                {Math.max(0, wa.limit_per_month - wa.used).toLocaleString("pt-BR")} restantes
                                            </span>
                                        </div>
                                    </>
                                )}

                                {pct >= 90 && (
                                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700/30 dark:bg-red-900/20 dark:text-red-400">
                                        ⚠️ Você está próximo do limite mensal. Entre em contato com o suporte para aumentar sua cota.
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-zinc-400">Sem dados de uso disponíveis.</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
