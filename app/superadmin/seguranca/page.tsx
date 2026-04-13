"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Shield, XCircle } from "lucide-react";
import { getSecurityOpsStatus } from "@/lib/superadmin/actions";

export default function SuperadminSegurancaPage() {
    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["sa", "security-ops"],
        queryFn:  () => getSecurityOpsStatus(),
        staleTime: 30_000,
    });

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                        Segurança e ambiente
                    </h1>
                    <p className="text-xs text-zinc-500">
                        Variáveis críticas (somente presença, sem valores). Útil após deploy na Vercel.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                    {isFetching ? "Atualizando…" : "Atualizar"}
                </button>
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-16 text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
                    {(error as Error).message}
                </div>
            )}

            {data && (
                <>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                Ambiente Node
                            </div>
                            <div className="mt-1 font-mono text-sm text-zinc-800 dark:text-zinc-100">
                                {data.nodeEnv}
                            </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                VERCEL_ENV
                            </div>
                            <div className="mt-1 font-mono text-sm text-zinc-800 dark:text-zinc-100">
                                {data.vercelEnv ?? "— (local ou fora da Vercel)"}
                            </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                Produção (lógica app)
                            </div>
                            <div className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">
                                {data.isProd ? "Sim (regras estritas de cron, etc.)" : "Não"}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                            <Shield className="h-4 w-4 text-primary" />
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Variáveis de ambiente
                            </h2>
                        </div>
                        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {data.checks.map((row) => (
                                <li
                                    key={row.key}
                                    className="flex gap-3 px-4 py-3 text-sm"
                                >
                                    {row.ok ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                            {row.label}
                                        </div>
                                        {!row.ok && (
                                            <p className="mt-1 text-xs text-zinc-500">{row.hint}</p>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200/90">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-2">
                            <p>
                                <strong>Rate limit</strong> em rotas públicas e no webhook WhatsApp é
                                em memória por instância serverless; picos em várias réplicas podem
                                parecer mais permissivos. Para métricas e alertas, use os logs da
                                Vercel (filtrar por caminho, status 401/429/500).
                            </p>
                            <p>
                                Esta página reflete o processo que respondeu à última requisição;
                                após alterar variáveis na Vercel, faça um redeploy ou aguarde o
                                próximo cold start.
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
