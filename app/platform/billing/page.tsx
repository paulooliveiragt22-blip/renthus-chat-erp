"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import { toast } from "sonner";

type SubRow = {
    id: string;
    status: string;
    allow_overage: boolean;
    companies?: { id: string; name: string; slug?: string } | null;
    plans?: { id: string; key: string; name: string; price_cents: number } | null;
};

export default function PlatformBillingPage() {
    const queryClient = useQueryClient();
    const [planEdits, setPlanEdits] = useState<Record<string, string>>({});

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["platform", "billing", "subscriptions"],
        queryFn: () => platformApi.billingSubscriptions(),
        staleTime: 30_000,
    });

    const { data: plansData } = useQuery({
        queryKey: ["platform", "plans"],
        queryFn: () => platformApi.plans(),
        staleTime: Infinity,
    });

    const plans = (plansData?.plans ?? []) as Array<{ id: string; key: string; name: string }>;
    const subscriptions = (data?.subscriptions ?? []) as SubRow[];

    const changePlan = useMutation({
        mutationFn: ({ id, plan_key }: { id: string; plan_key: string }) =>
            platformApi.changePlan(id, plan_key, "ajuste via /platform/billing"),
        onSuccess: () => {
            toast.success("Plano atualizado");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const toggleOverage = useMutation({
        mutationFn: ({ id, allow_overage }: { id: string; allow_overage: boolean }) =>
            platformApi.allowOverage(id, allow_overage, "ajuste via /platform/billing"),
        onSuccess: () => {
            toast.success("Overage atualizado");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Billing</h1>
                    <p className="text-xs text-zinc-500">
                        Assinaturas cross-tenant ({subscriptions.length})
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
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
                                    Empresa
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Plano
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Status
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Overage
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Ações
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {subscriptions.map((s) => {
                                const selected =
                                    planEdits[s.id] ?? s.plans?.key ?? plans[0]?.key ?? "";
                                return (
                                    <tr key={s.id}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                                {s.companies?.name ?? "—"}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">
                                                {s.companies?.slug ?? s.id.slice(0, 8)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">{s.plans?.name ?? "—"}</td>
                                        <td className="px-3 py-2 text-xs">{s.status}</td>
                                        <td className="px-3 py-2 text-xs">
                                            {s.allow_overage ? "Sim" : "Não"}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <select
                                                    value={selected}
                                                    onChange={(e) =>
                                                        setPlanEdits((m) => ({
                                                            ...m,
                                                            [s.id]: e.target.value,
                                                        }))
                                                    }
                                                    className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                >
                                                    {plans.map((p) => (
                                                        <option key={p.id} value={p.key}>
                                                            {p.name} ({p.key})
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    disabled={changePlan.isPending}
                                                    onClick={() =>
                                                        changePlan.mutate({
                                                            id: s.id,
                                                            plan_key: selected,
                                                        })
                                                    }
                                                    className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                                >
                                                    Aplicar plano
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={toggleOverage.isPending}
                                                    onClick={() =>
                                                        toggleOverage.mutate({
                                                            id: s.id,
                                                            allow_overage: !s.allow_overage,
                                                        })
                                                    }
                                                    className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                                                >
                                                    {s.allow_overage
                                                        ? "Desligar overage"
                                                        : "Ligar overage"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {subscriptions.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-3 py-8 text-center text-xs text-zinc-400"
                                    >
                                        Nenhuma assinatura.
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
