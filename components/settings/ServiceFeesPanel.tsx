"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Percent, Plus, Receipt, Trash2 } from "lucide-react";

type FeeDef = {
    id: string;
    name: string;
    slug: string;
    system_key: "delivery" | "service" | "other" | null;
    calc_mode: "fixed" | "percent";
    value: number;
    is_active: boolean;
    sort_order: number;
};

const KEY_LABEL: Record<string, string> = {
    delivery: "Entrega",
    service: "Serviço",
    other: "Outro",
};

function formatValue(d: FeeDef): string {
    if (d.calc_mode === "percent") return `${d.value}%`;
    return d.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ServiceFeesPanel() {
    const [defs, setDefs] = useState<FeeDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [calcMode, setCalcMode] = useState<"fixed" | "percent">("fixed");
    const [value, setValue] = useState("0");
    const [systemKey, setSystemKey] = useState<"" | "delivery" | "service" | "other">("service");
    const [editId, setEditId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);
        const res = await fetch("/api/admin/taxas", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setLoading(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Não foi possível carregar as taxas");
            return;
        }
        setDefs((json.definitions ?? []) as FeeDef[]);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    function resetForm() {
        setEditId(null);
        setName("");
        setCalcMode("fixed");
        setValue("0");
        setSystemKey("service");
    }

    function startEdit(d: FeeDef) {
        setEditId(d.id);
        setName(d.name);
        setCalcMode(d.calc_mode);
        setValue(String(d.value).replace(".", ","));
        setSystemKey(d.system_key ?? "");
    }

    async function save() {
        if (!name.trim()) {
            setMsg("Informe o nome da taxa");
            return;
        }
        setSaving(true);
        setMsg(null);
        const payload = {
            id: editId ?? undefined,
            name: name.trim(),
            calc_mode: calcMode,
            value: Number.parseFloat(value.replace(",", ".")),
            system_key: systemKey === "" ? null : systemKey,
            is_active: true,
        };
        const res = await fetch("/api/admin/taxas", {
            method: editId ? "PATCH" : "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao salvar");
            return;
        }
        resetForm();
        await load();
    }

    async function deactivate(id: string) {
        if (!window.confirm("Desativar esta taxa?")) return;
        setSaving(true);
        const res = await fetch(`/api/admin/taxas?id=${encodeURIComponent(id)}`, {
            method: "DELETE",
            credentials: "include",
        });
        setSaving(false);
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            setMsg(json?.error ?? "Falha ao desativar");
            return;
        }
        if (editId === id) resetForm();
        await load();
    }

    const active = defs.filter((d) => d.is_active);
    const inactive = defs.filter((d) => !d.is_active);

    return (
        <div className="space-y-6">
            <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    <Receipt className="h-4 w-4" />
                    Taxas de serviço
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                    Entrega, garçom, couvert etc. Nomes livres; valor fixo (R$) ou % sobre o subtotal dos
                    itens. Na liquidação: entrega → conta 3.2; demais → 3.3.
                </p>
            </div>

            {msg && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {msg}
                </p>
            )}

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {editId ? "Editar taxa" : "Nova taxa"}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">Nome</span>
                        <input
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex.: Taxa de garçom"
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">Tipo</span>
                        <select
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                            value={systemKey}
                            onChange={(e) =>
                                setSystemKey(e.target.value as typeof systemKey)
                            }
                        >
                            <option value="delivery">Entrega (única por empresa)</option>
                            <option value="service">Serviço</option>
                            <option value="other">Outro</option>
                            <option value="">Sem classificação</option>
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">Cálculo</span>
                        <select
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                            value={calcMode}
                            onChange={(e) =>
                                setCalcMode(e.target.value as "fixed" | "percent")
                            }
                        >
                            <option value="fixed">Valor fixo (R$)</option>
                            <option value="percent">Percentual (%)</option>
                        </select>
                    </label>
                    <label className="block text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">
                            {calcMode === "percent" ? "Percentual" : "Valor (R$)"}
                        </span>
                        <div className="relative mt-1">
                            {calcMode === "percent" && (
                                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                            )}
                            <input
                                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                inputMode="decimal"
                            />
                        </div>
                    </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save()}
                        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {editId ? "Salvar" : "Adicionar"}
                    </button>
                    {editId && (
                        <button
                            type="button"
                            onClick={resetForm}
                            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                        >
                            Cancelar
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
            ) : (
                <div className="space-y-2">
                    {active.length === 0 && (
                        <p className="text-sm text-zinc-500">Nenhuma taxa ativa.</p>
                    )}
                    {active.map((d) => (
                        <div
                            key={d.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/40"
                        >
                            <div>
                                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {d.name}
                                </p>
                                <p className="text-xs text-zinc-500">
                                    {KEY_LABEL[d.system_key ?? ""] ?? "Geral"} · {formatValue(d)}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="text-sm text-zinc-600 underline dark:text-zinc-300"
                                    onClick={() => startEdit(d)}
                                >
                                    Editar
                                </button>
                                {d.system_key !== "delivery" && (
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-sm text-red-600"
                                        onClick={() => void deactivate(d.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Desativar
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {inactive.length > 0 && (
                        <p className="pt-2 text-xs text-zinc-400">
                            {inactive.length} taxa(s) desativada(s) ocultas da lista operacional.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
