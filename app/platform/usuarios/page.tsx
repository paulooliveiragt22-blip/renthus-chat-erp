"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";

export default function PlatformUsuariosPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["platform", "users"],
        queryFn: () => platformApi.users(),
        staleTime: 30_000,
    });

    const users = data?.users ?? [];

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    Usuários platform
                </h1>
                <p className="text-xs text-zinc-500">
                    Operadores Renthus/Lysthub. Bootstrap via{" "}
                    <code className="font-mono">scripts/bootstrap-platform-user.mjs</code>
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
                                {users.map((u: Record<string, unknown>) => (
                                    <tr key={String(u.id)}>
                                        <td className="px-4 py-3 font-medium">{String(u.display_name)}</td>
                                        <td className="px-4 py-3 text-xs text-zinc-500">{String(u.email)}</td>
                                        <td className="px-4 py-3 text-xs">{String(u.role)}</td>
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
