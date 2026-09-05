"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Percent, Plus, Trash2 } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

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

function formatValue(d: FeeDef): string {
    if (d.calc_mode === "percent") return `${d.value}%`;
    return d.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseValueInput(raw: string): number {
    return Number.parseFloat(raw.replace(",", "."));
}

export default function ServiceFeesPanel() {
    const [defs, setDefs] = useState<FeeDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    // Entrega: só cálculo + valor (cobrança on/off fica na aba Delivery)
    const [deliveryCalc, setDeliveryCalc] = useState<"fixed" | "percent">("fixed");
    const [deliveryValue, setDeliveryValue] = useState("0");

    // Outras taxas
    const [name, setName] = useState("");
    const [calcMode, setCalcMode] = useState<"fixed" | "percent">("fixed");
    const [value, setValue] = useState("0");
    const [editId, setEditId] = useState<string | null>(null);

    const delivery = useMemo(
        () => defs.find((d) => d.system_key === "delivery") ?? null,
        [defs]
    );
    const others = useMemo(
        () => defs.filter((d) => d.is_active && d.system_key !== "delivery"),
        [defs]
    );
    const inactiveCount = useMemo(
        () => defs.filter((d) => !d.is_active && d.system_key !== "delivery").length,
        [defs]
    );

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
        const list = (json.definitions ?? []) as FeeDef[];
        setDefs(list);
        const del = list.find((d) => d.system_key === "delivery");
        if (del) {
            setDeliveryCalc(del.calc_mode);
            setDeliveryValue(String(del.value).replace(".", ","));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    function resetOtherForm() {
        setEditId(null);
        setName("");
        setCalcMode("fixed");
        setValue("0");
    }

    function startEditOther(d: FeeDef) {
        setEditId(d.id);
        setName(d.name);
        setCalcMode(d.calc_mode);
        setValue(String(d.value).replace(".", ","));
    }

    async function saveDelivery() {
        if (!delivery) {
            setMsg("Taxa de entrega não encontrada para esta empresa.");
            return;
        }
        const n = parseValueInput(deliveryValue);
        if (!Number.isFinite(n) || n < 0) {
            setMsg("Informe um valor válido");
            return;
        }
        if (deliveryCalc === "percent" && n > 100) {
            setMsg("Percentual deve ser no máximo 100");
            return;
        }
        setSaving(true);
        setMsg(null);
        const res = await fetch("/api/admin/taxas", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: delivery.id,
                name: delivery.name,
                slug: delivery.slug,
                system_key: "delivery",
                calc_mode: deliveryCalc,
                value: n,
                is_active: delivery.is_active,
                sort_order: delivery.sort_order,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao salvar taxa de entrega");
            return;
        }
        await load();
    }

    async function saveOther() {
        if (!name.trim()) {
            setMsg("Informe o nome da taxa");
            return;
        }
        const n = parseValueInput(value);
        if (!Number.isFinite(n) || n < 0) {
            setMsg("Informe um valor válido");
            return;
        }
        if (calcMode === "percent" && n > 100) {
            setMsg("Percentual deve ser no máximo 100");
            return;
        }
        setSaving(true);
        setMsg(null);
        const payload: Record<string, unknown> = {
            id: editId ?? undefined,
            name: name.trim(),
            calc_mode: calcMode,
            value: n,
            system_key: "service",
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
        resetOtherForm();
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
        if (editId === id) resetOtherForm();
        await load();
    }

    return (
        <div className="space-y-8">
            {msg && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {msg}
                </p>
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
            ) : (
                <>
                    {/* Entrega — nome fixo; só cálculo e valor */}
                    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Taxa de entrega
                        </h3>
                        <p className="mt-1 text-xs text-zinc-500">
                            Valor padrão (R$ ou %). Ligar/desligar a cobrança fica em Delivery.
                            Overrides por bairro também.
                        </p>
                        {!delivery ? (
                            <p className="mt-3 text-sm text-zinc-500">
                                Definição de entrega ainda não existe nesta empresa.
                            </p>
                        ) : (
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <p className="sm:col-span-2 text-xs text-zinc-500">
                                    Cobrança:{" "}
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                        {delivery.is_active ? "ativa" : "desligada"}
                                    </span>{" "}
                                    (alterar em Delivery).
                                </p>
                                <label className="block text-sm">
                                    <span className="text-zinc-600 dark:text-zinc-400">Cálculo</span>
                                    <Select
                                        value={deliveryCalc}
                                        onValueChange={(v) =>
                                            setDeliveryCalc(v as "fixed" | "percent")
                                        }
                                    >
                                        <SelectTrigger className="mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                                            <SelectItem value="percent">Percentual (%)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </label>
                                <label className="block text-sm">
                                    <span className="text-zinc-600 dark:text-zinc-400">
                                        {deliveryCalc === "percent" ? "Percentual" : "Valor (R$)"}
                                    </span>
                                    <div className="relative mt-1">
                                        {deliveryCalc === "percent" && (
                                            <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                        )}
                                        <input
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                                            value={deliveryValue}
                                            onChange={(e) => setDeliveryValue(e.target.value)}
                                            inputMode="decimal"
                                        />
                                    </div>
                                </label>
                                <div className="sm:col-span-2">
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => void saveDelivery()}
                                        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                                    >
                                        {saving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : null}
                                        Salvar entrega
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Outras taxas */}
                    <section className="space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                Outras taxas
                            </h3>
                            <p className="mt-1 text-xs text-zinc-500">
                                Nomes livres (ex.: garçom, couvert). Valor fixo (R$) ou % sobre o
                                subtotal dos itens.
                            </p>
                        </div>

                        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                            <p className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                {editId ? "Editar taxa" : "Nova taxa"}
                            </p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="block text-sm sm:col-span-2">
                                    <span className="text-zinc-600 dark:text-zinc-400">Nome</span>
                                    <input
                                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Ex.: Taxa de garçom"
                                    />
                                </label>
                                <label className="block text-sm">
                                    <span className="text-zinc-600 dark:text-zinc-400">Cálculo</span>
                                    <Select
                                        value={calcMode}
                                        onValueChange={(v) =>
                                            setCalcMode(v as "fixed" | "percent")
                                        }
                                    >
                                        <SelectTrigger className="mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                                            <SelectItem value="percent">Percentual (%)</SelectItem>
                                        </SelectContent>
                                    </Select>
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
                                    onClick={() => void saveOther()}
                                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                                >
                                    {saving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Plus className="h-4 w-4" />
                                    )}
                                    {editId ? "Salvar" : "Adicionar"}
                                </button>
                                {editId && (
                                    <button
                                        type="button"
                                        onClick={resetOtherForm}
                                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {others.length === 0 && (
                                <p className="text-sm text-zinc-500">Nenhuma outra taxa ativa.</p>
                            )}
                            {others.map((d) => (
                                <div
                                    key={d.id}
                                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/40"
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {d.name}
                                        </p>
                                        <p className="text-xs text-zinc-500">{formatValue(d)}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className="text-sm text-zinc-600 underline dark:text-zinc-300"
                                            onClick={() => startEditOther(d)}
                                        >
                                            Editar
                                        </button>
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 text-sm text-red-600"
                                            onClick={() => void deactivate(d.id)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Desativar
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {inactiveCount > 0 && (
                                <p className="pt-1 text-xs text-zinc-400">
                                    {inactiveCount} taxa(s) desativada(s).
                                </p>
                            )}
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
