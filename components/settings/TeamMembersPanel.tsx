"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import PlanFeatureGate from "@/components/billing/PlanFeatureGate";
import { roleLabel, type CompanyRole } from "@/lib/workspace/staffRoles";

type Profile = {
    id: string;
    name: string;
    template_key: string;
    is_active: boolean;
};

type Member = {
    id: string;
    user_id: string;
    role: string;
    is_active: boolean;
    created_at: string;
    profile_id: string | null;
    email: string | null;
};

function normalizeRole(r: string): CompanyRole | string {
    if (r === "staff") return "member";
    return r;
}

export default function TeamMembersPanel() {
    const [members, setMembers] = useState<Member[]>([]);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [inviteable, setInviteable] = useState<CompanyRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<CompanyRole>("member");
    const [profileId, setProfileId] = useState("");

    const activeProfiles = useMemo(
        () => profiles.filter((p) => p.is_active),
        [profiles]
    );

    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);
        const res = await fetch("/api/admin/users", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setLoading(false);
        if (!res.ok) {
            setMsg(json?.hint ?? json?.error ?? "Não foi possível carregar a equipe");
            return;
        }
        setMembers((json.members ?? []) as Member[]);
        const plist = (json.profiles ?? []) as Profile[];
        setProfiles(plist);
        const roles = (json.inviteable_roles ?? []) as CompanyRole[];
        setInviteable(roles);
        if (roles.length > 0 && !roles.includes(role)) {
            setRole(roles[0]!);
        }
        if (!profileId && plist[0]?.id) setProfileId(plist[0].id);
    }, [role, profileId]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function invite() {
        if (!email.trim()) {
            setMsg("Informe o e-mail do colaborador");
            return;
        }
        if (role === "member" && !profileId) {
            setMsg("Selecione um perfil de acesso para o operador");
            return;
        }
        setSaving(true);
        setMsg(null);
        const res = await fetch("/api/admin/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                email: email.trim(),
                role,
                profile_id: role === "member" ? profileId : null,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao convidar");
            return;
        }
        setEmail("");
        setMsg(json.invited ? "Convite enviado por e-mail." : "Usuário vinculado à empresa.");
        await load();
    }

    async function patchMember(
        id: string,
        body: { role?: string; is_active?: boolean; profile_id?: string | null }
    ) {
        setSaving(true);
        setMsg(null);
        const res = await fetch(`/api/admin/users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao atualizar");
            return;
        }
        await load();
    }

    async function removeMember(id: string) {
        if (!window.confirm("Remover este usuário da empresa? O acesso será revogado.")) return;
        setSaving(true);
        setMsg(null);
        const res = await fetch(`/api/admin/users/${id}`, {
            method: "DELETE",
            credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setMsg(json?.error ?? "Falha ao remover");
            return;
        }
        await load();
    }

    function profileName(id: string | null): string {
        if (!id) return "—";
        return profiles.find((p) => p.id === id)?.name ?? "Perfil";
    }

    return (
        <PlanFeatureGate
            featureKey="staff_users"
            title="Gestão de equipe"
            description="Convide colaboradores e vincule a um perfil de permissões."
            requiredPlanLabel="Pro ou Market"
        >
            <div className="rounded-xl border border-zinc-100 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                        <Users className="h-4 w-4 text-orange-500" />
                    </span>
                    <div>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Equipe</p>
                        <p className="text-xs text-zinc-400">
                            Proprietário e administrador gerenciam. Operador usa o perfil atribuído.
                        </p>
                    </div>
                </div>

                {msg && (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {msg}
                    </div>
                )}

                {inviteable.length > 0 && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                        <div className="min-w-[12rem] flex-1">
                            <label className="text-[11px] font-semibold text-zinc-500">E-mail</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="colaborador@empresa.com"
                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-semibold text-zinc-500">Papel</label>
                            <select
                                value={role}
                                onChange={(e) => setRole(e.target.value as CompanyRole)}
                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                            >
                                {inviteable.map((r) => (
                                    <option key={r} value={r}>
                                        {roleLabel(r)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {role === "member" && (
                            <div className="min-w-[10rem]">
                                <label className="text-[11px] font-semibold text-zinc-500">Perfil</label>
                                <select
                                    value={profileId}
                                    onChange={(e) => setProfileId(e.target.value)}
                                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                >
                                    {activeProfiles.length === 0 ? (
                                        <option value="">Crie um perfil primeiro</option>
                                    ) : (
                                        activeProfiles.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => void invite()}
                            disabled={saving}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Plus className="h-3.5 w-3.5" />
                            )}
                            Convidar
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                    </div>
                ) : members.length === 0 ? (
                    <p className="py-4 text-sm text-zinc-400">Nenhum membro listado.</p>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {members.map((m) => {
                            const r = (normalizeRole(m.role) as CompanyRole) || "member";
                            const canEditRole = r !== "owner" && inviteable.includes("admin");
                            return (
                                <div
                                    key={m.id}
                                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {m.email ?? m.user_id.slice(0, 8)}
                                        </p>
                                        <p className="text-[11px] text-zinc-400">
                                            {roleLabel(r)}
                                            {r === "member" ? ` · ${profileName(m.profile_id)}` : ""}
                                            {!m.is_active ? " · inativo" : ""}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {canEditRole && m.is_active && (
                                            <select
                                                value={r}
                                                disabled={saving}
                                                onChange={(e) => {
                                                    const next = e.target.value as CompanyRole;
                                                    if (next === "member") {
                                                        const pid =
                                                            m.profile_id || activeProfiles[0]?.id || "";
                                                        if (!pid) {
                                                            setMsg(
                                                                "Crie um perfil antes de definir operador"
                                                            );
                                                            return;
                                                        }
                                                        void patchMember(m.id, {
                                                            role: next,
                                                            profile_id: pid,
                                                        });
                                                    } else {
                                                        void patchMember(m.id, {
                                                            role: next,
                                                            profile_id: null,
                                                        });
                                                    }
                                                }}
                                                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                            >
                                                <option value="admin">{roleLabel("admin")}</option>
                                                <option value="member">{roleLabel("member")}</option>
                                            </select>
                                        )}
                                        {r === "member" &&
                                            m.is_active &&
                                            activeProfiles.length > 0 && (
                                                <select
                                                    value={m.profile_id ?? ""}
                                                    disabled={saving}
                                                    onChange={(e) =>
                                                        void patchMember(m.id, {
                                                            profile_id: e.target.value,
                                                        })
                                                    }
                                                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                >
                                                    {activeProfiles.map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                        {r !== "owner" && (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={saving}
                                                    onClick={() =>
                                                        void patchMember(m.id, {
                                                            is_active: !m.is_active,
                                                        })
                                                    }
                                                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                                                        m.is_active
                                                            ? "border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                                                            : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400"
                                                    }`}
                                                >
                                                    {m.is_active ? "Desativar" : "Reativar"}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={saving}
                                                    onClick={() => void removeMember(m.id)}
                                                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                                                >
                                                    Remover
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </PlanFeatureGate>
    );
}
