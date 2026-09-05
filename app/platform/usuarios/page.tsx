"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, UserPlus, Users } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import { PLATFORM_ROLES } from "@/lib/platform/platformRoles";
import { toast } from "sonner";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function PlatformUsuariosPage() {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [role, setRole] = useState<(typeof PLATFORM_ROLES)[number]>("ops");

    const { data, isLoading, error } = useQuery({
        queryKey: ["platform", "users"],
        queryFn: () => platformApi.users(),
        staleTime: 30_000,
    });

    const invite = useMutation({
        mutationFn: () =>
            platformApi.inviteUser({
                email,
                display_name: displayName,
                role,
            }),
        onSuccess: (res) => {
            toast.success(
                res.invited
                    ? "Convite enviado por e-mail"
                    : "Usuário platform vinculado (já tinha Auth)"
            );
            setEmail("");
            setDisplayName("");
            queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const users = data?.users ?? [];

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    Usuários platform
                </h1>
                <p className="text-xs text-zinc-500">
                    Operadores RenthusAgent. Convite por e-mail (Supabase Auth) +{" "}
                    <code className="font-mono">platform_users</code>.
                </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    <UserPlus className="h-4 w-4" />
                    Convidar operador
                </div>
                <form
                    className="grid gap-2 sm:grid-cols-4 sm:items-end"
                    onSubmit={(e) => {
                        e.preventDefault();
                        invite.mutate();
                    }}
                >
                    <label className="text-xs text-zinc-500 sm:col-span-1">
                        Nome
                        <input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            required
                            minLength={2}
                        />
                    </label>
                    <label className="text-xs text-zinc-500 sm:col-span-1">
                        E-mail
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            required
                        />
                    </label>
                    <label className="text-xs text-zinc-500">
                        Role
                        <Select
                            value={role}
                            onValueChange={(v) =>
                                setRole(v as (typeof PLATFORM_ROLES)[number])
                            }
                        >
                            <SelectTrigger className="mt-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PLATFORM_ROLES.map((r) => (
                                    <SelectItem key={r} value={r}>
                                        {r}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                    <button
                        type="submit"
                        disabled={invite.isPending}
                        className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                        {invite.isPending ? "Enviando…" : "Convidar"}
                    </button>
                </form>
                <p className="mt-2 text-[11px] text-zinc-400">
                    Roles superadmin/ops exigem MFA após o primeiro login.
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
                    {users.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-16 text-zinc-400">
                            <Users className="h-8 w-8 opacity-30" />
                            <p className="text-sm">Nenhum usuário platform cadastrado</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                        Nome
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                        E-mail
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                        Role
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                        MFA
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {users.map((u) => (
                                    <tr key={u.id}>
                                        <td className="px-4 py-3 font-medium">
                                            {u.display_name}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-zinc-500">
                                            {u.email}
                                        </td>
                                        <td className="px-4 py-3 text-xs">{u.role}</td>
                                        <td className="px-4 py-3 text-xs">
                                            {u.mfa_required ? "Obrigatório" : "Opcional"}
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            {u.is_active ? "Ativo" : "Inativo"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
