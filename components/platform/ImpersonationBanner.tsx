"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EyeOff } from "lucide-react";

export default function ImpersonationBanner() {
    const router = useRouter();
    const { data, isLoading } = useQuery({
        queryKey: ["platform", "impersonation"],
        queryFn: async () => {
            const res = await fetch("/api/platform/impersonate");
            if (res.status === 401 || res.status === 403) return { active: false as const };
            if (!res.ok) return { active: false as const };
            return res.json() as Promise<{
                active: boolean;
                companyName?: string;
                reason?: string;
                expiresAt?: string;
            }>;
        },
        staleTime: 15_000,
        refetchInterval: 60_000,
    });

    if (isLoading || !data?.active) return null;

    async function endSession() {
        await fetch("/api/platform/impersonate", { method: "DELETE" });
        router.push("/platform/empresas");
        router.refresh();
    }

    return (
        <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="min-w-0">
                <span className="font-semibold">Modo suporte (somente leitura)</span>
                {" — "}
                <span className="truncate">
                    {data.companyName ?? "empresa"}
                    {data.reason ? ` · ${data.reason}` : ""}
                </span>
            </div>
            <button
                type="button"
                onClick={endSession}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100"
            >
                <EyeOff className="h-3.5 w-3.5" />
                Sair do modo suporte
            </button>
        </div>
    );
}
