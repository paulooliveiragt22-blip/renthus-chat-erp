"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import PlanFeatureGate from "@/components/billing/PlanFeatureGate";
import {
    capabilityLabel,
    type CapabilityKey,
} from "@/lib/workspace/rbac/capabilities";

type CatalogGroup = {
    id: string;
    label: string;
    keys: CapabilityKey[];
};

type Profile = {
    id: string;
    name: string;
    template_key: string;
    capabilities: string[] | null;
    is_active: boolean;
};

export default function StaffProfilesPanel() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [caps, setCaps] = useState<Set<CapabilityKey>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);
        const res = await fetch("/api/admin/staff-profiles", {
            credentials: "include",
            cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        setLoading(false);
        if (!res.ok) {
            setMsg(json?.hint ?? json?.error ?? "Não foi possível carregar os perfis");
            return;
        }
        setProfiles((json.profiles ?? []) as Profile[]);
        setCatalog((json.catalog ?? []) as CatalogGroup[]);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    function openCreate() {
        setCreating(true);
        setEditingId(null);
        setName("");
        setCaps(new Set());
        setMsg(null);
    }

    function openEdit(p: Profile) {
        setCreating(false);
        setEditingId(p.id);
        setName(p.name);
        setCaps(new Set((p.capabilities ?? []).filter(Boolean) as CapabilityKey[]));
        setMsg(null);
    }

    function cancelEditor() {
        setCreating(false);
        setEditingId(null);
        setName("");
        setCaps(new Set());
    }

    function toggleCap(key: CapabilityKey) {
        setCaps((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    async function save() {
        const trimmed = name.trim();
        if (!trimmed) {
            setMsg("Informe o nome do perfil");
            return;
        }
        setSaving(true);
        setMsg(null);
        const body = {
            name: trimmed,
            capabilities: Array.from(caps),
            ...(creating ? { template_key: "custom" } : {}),
        };
        const res = await fetch(
            creating ? "/api/admin/staff-profiles" : `/api/admin/staff-profiles/${editingId}`,
            {
                method: creating ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            }
        );
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao salvar perfil");
            return;
        }
        cancelEditor();
        await load();
    }

    async function remove(id: string) {
        if (!window.confirm("Excluir este perfil? Só é permitido se nenhum operador estiver usando.")) {
            return;
        }
        setSaving(true);
        setMsg(null);
        const res = await fetch(`/api/admin/staff-profiles/${id}`, {
            method: "DELETE",
            credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.hint ?? json?.error ?? "Falha ao excluir");
            return;
        }
        if (editingId === id) cancelEditor();
        await load();
    }

    const editorOpen = creating || editingId !== null;

    return (
        <PlanFeatureGate
            featureKey="staff_users"
            title="Perfis de acesso"
            description="Monte perfis com permissões e vincule aos operadores."
            requiredPlanLabel="Pro ou Market"
        >
            <div className="rounded-xl border border-zinc-100 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                            <Shield className="h-4 w-4 text-violet-600" />
                        </span>
                        <div>
                            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                Perfis de acesso
                            </p>
                            <p className="text-xs text-zinc-400">
                                Padrão: Atendente/Caixa, Cozinha, Entregador, Garçom — ou monte do zero
                                (Outro).
                            </p>
                        </div>
                    </div>
                    {!editorOpen && (
                        <button
                            type="button"
                            onClick={openCreate}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Criar do zero
                        </button>
                    )}
                </div>

                {msg && (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {msg}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {profiles.map((p) => (
                            <div
                                key={p.id}
                                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                        {p.name}
                                    </p>
                                    <p className="text-[11px] text-zinc-400">
                                        {(p.capabilities ?? []).length} permissões
                                        {!p.is_active ? " · inativo" : ""}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => openEdit(p)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
                                    >
                                        <Pencil className="h-3 w-3" /> Editar
                                    </button>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => void remove(p.id)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                                    >
                                        <Trash2 className="h-3 w-3" /> Excluir
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {editorOpen && (
                    <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-800/50 dark:bg-violet-950/20">
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {creating ? "Novo perfil (Outro)" : "Editar perfil"}
                        </p>
                        <div>
                            <label className="text-[11px] font-semibold text-zinc-500">Nome</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Ex.: Supervisor de turno"
                                maxLength={80}
                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                            />
                        </div>
                        <div className="space-y-3">
                            {catalog.map((group) => (
                                <div key={group.id}>
                                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                        {group.label}
                                    </p>
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                        {group.keys.map((key) => (
                                            <label
                                                key={key}
                                                className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 text-xs text-zinc-700 dark:text-zinc-300"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={caps.has(key)}
                                                    onChange={() => toggleCap(key)}
                                                    className="mt-0.5"
                                                />
                                                <span>{capabilityLabel(key)}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => void save()}
                                className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                                {saving ? "Salvando…" : "Salvar"}
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={cancelEditor}
                                className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </PlanFeatureGate>
    );
}
