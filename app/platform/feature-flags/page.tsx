"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Flag, Loader2, Plus } from "lucide-react";
import { platformApi, type PlatformFeatureFlag } from "@/lib/platform/clientApi";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function PlatformFeatureFlagsPage() {
    const queryClient = useQueryClient();
    const [newKey, setNewKey] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [overrideKey, setOverrideKey] = useState("");
    const [overrideCompanyId, setOverrideCompanyId] = useState("");
    const [overrideEnabled, setOverrideEnabled] = useState(true);

    const { data, isLoading, error } = useQuery({
        queryKey: ["platform", "feature-flags"],
        queryFn: () => platformApi.featureFlags(),
        staleTime: 15_000,
    });

    const flags = data?.flags ?? [];

    const upsert = useMutation({
        mutationFn: (payload: {
            key: string;
            description?: string;
            enabled_global: boolean;
        }) => platformApi.upsertFeatureFlag(payload),
        onSuccess: () => {
            toast.success("Flag salva");
            queryClient.invalidateQueries({ queryKey: ["platform", "feature-flags"] });
            setNewKey("");
            setNewDesc("");
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const setOverride = useMutation({
        mutationFn: () =>
            platformApi.setFeatureFlagOverride({
                key: overrideKey,
                company_id: overrideCompanyId,
                enabled: overrideEnabled,
            }),
        onSuccess: () => {
            toast.success("Override salvo");
            queryClient.invalidateQueries({ queryKey: ["platform", "feature-flags"] });
            setOverrideCompanyId("");
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const removeOverride = useMutation({
        mutationFn: (id: string) => platformApi.deleteFeatureFlagOverride(id),
        onSuccess: () => {
            toast.success("Override removido");
            queryClient.invalidateQueries({ queryKey: ["platform", "feature-flags"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    Feature flags
                </h1>
                <p className="text-xs text-zinc-500">
                    Kill-switches globais e overrides por empresa. Resolução via{" "}
                    <code className="font-mono">rpc_platform_is_feature_enabled</code>.
                </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    <Plus className="h-4 w-4" />
                    Criar / atualizar flag
                </div>
                <form
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    onSubmit={(e) => {
                        e.preventDefault();
                        upsert.mutate({
                            key: newKey,
                            description: newDesc,
                            enabled_global: false,
                        });
                    }}
                >
                    <label className="flex-1 text-xs text-zinc-500">
                        Key
                        <input
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                            placeholder="chatbot.outbound_paused"
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            required
                        />
                    </label>
                    <label className="flex-[2] text-xs text-zinc-500">
                        Descrição
                        <input
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={upsert.isPending}
                        className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                        Salvar
                    </button>
                </form>
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
                <div className="space-y-3">
                    {flags.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-16 text-zinc-400">
                            <Flag className="h-8 w-8 opacity-30" />
                            <p className="text-sm">Nenhuma flag cadastrada</p>
                        </div>
                    ) : (
                        flags.map((flag: PlatformFeatureFlag) => (
                            <div
                                key={flag.key}
                                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                            >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {flag.key}
                                        </div>
                                        <p className="mt-0.5 text-xs text-zinc-500">
                                            {flag.description || "—"}
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                                        <Switch
                                            checked={flag.enabled_global}
                                            disabled={upsert.isPending}
                                            onCheckedChange={(checked) =>
                                                upsert.mutate({
                                                    key: flag.key,
                                                    description: flag.description,
                                                    enabled_global: checked,
                                                })
                                            }
                                        />
                                        Global ligado
                                    </label>
                                </div>

                                {(flag.overrides?.length ?? 0) > 0 && (
                                    <ul className="mt-3 space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                                        {flag.overrides?.map((o) => (
                                            <li
                                                key={o.id}
                                                className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400"
                                            >
                                                <span>
                                                    {o.companies?.name ?? o.company_id}:{" "}
                                                    <strong>
                                                        {o.enabled ? "ON" : "OFF"}
                                                    </strong>
                                                </span>
                                                <button
                                                    type="button"
                                                    className="text-red-600 hover:underline"
                                                    onClick={() =>
                                                        removeOverride.mutate(o.id)
                                                    }
                                                >
                                                    Remover
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    Override por empresa
                </div>
                <form
                    className="grid gap-2 sm:grid-cols-4 sm:items-end"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!overrideKey.trim() || !overrideCompanyId.trim()) return;
                        setOverride.mutate();
                    }}
                >
                    <label className="text-xs text-zinc-500 sm:col-span-1">
                        Flag
                        <Select
                            value={overrideKey || undefined}
                            onValueChange={setOverrideKey}
                        >
                            <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                                {flags.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.key}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                    <label className="text-xs text-zinc-500 sm:col-span-2">
                        Company ID (UUID)
                        <input
                            value={overrideCompanyId}
                            onChange={(e) => setOverrideCompanyId(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            required
                        />
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-200">
                        <Switch
                            checked={overrideEnabled}
                            onCheckedChange={setOverrideEnabled}
                        />
                        Enabled
                    </label>
                    <button
                        type="submit"
                        disabled={setOverride.isPending}
                        className="h-10 rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800"
                    >
                        Aplicar override
                    </button>
                </form>
            </div>
        </div>
    );
}
