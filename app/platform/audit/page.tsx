"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";

export default function PlatformAuditPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["platform", "audit"],
        queryFn: () => platformApi.audit(0, 100),
        staleTime: 15_000,
    });

    const rows = data?.rows ?? [];

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Audit log</h1>
                <p className="text-xs text-zinc-500">
                    Ações registradas no console platform ({data?.total ?? 0} total)
                </p>
            </div>

            {isLoading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {(error as Error).message}
                </div>
            )}

            {!isLoading && !error && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Quando
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Actor
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Ação
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Recurso
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Outcome
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {rows.map((r) => (
                                <tr key={r.id}>
                                    <td className="px-3 py-2 text-xs text-zinc-500">
                                        {r.occurred_at
                                            ? new Date(r.occurred_at).toLocaleString("pt-BR")
                                            : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {r.actor_email ?? "—"}
                                        {r.actor_role ? (
                                            <span className="ml-1 text-zinc-400">
                                                ({r.actor_role})
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-[11px]">{r.action}</td>
                                    <td className="px-3 py-2 text-xs">
                                        {r.resource_type}
                                        {r.resource_id ? ` / ${r.resource_id.slice(0, 8)}…` : ""}
                                    </td>
                                    <td className="px-3 py-2 text-xs">{r.outcome}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-8 text-center text-xs text-zinc-400">
                                        Nenhum registro ainda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
