"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, Loader2 } from "lucide-react";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";

type Props = {
    featureKey: string;
    title: string;
    description: string;
    children: ReactNode;
};

/**
 * Mostra o conteúdo só se o plano tiver a feature (Market).
 * Usa o mesmo cache compartilhado de usePlanFeatures (sem fetch próprio).
 */
export default function MarketPlanGate({ featureKey, title, description, children }: Props) {
    const { loading, has, planKey } = usePlanFeatures();
    const allowed = has(featureKey) || String(planKey ?? "").toLowerCase() === "market";

    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-zinc-100 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando plano…
            </div>
        );
    }

    if (allowed) return <>{children}</>;

    return (
        <div className="rounded-xl border border-dashed border-amber-300/80 bg-amber-50/60 p-5 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-amber-100 p-2 dark:bg-amber-900/40">
                    <Lock className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                        Disponível no plano Market (R$ 397/mês).
                    </p>
                    <Link
                        href="/configuracoes?tab=plano"
                        className="mt-3 inline-flex rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                        Ver planos e upgrade
                    </Link>
                </div>
            </div>
        </div>
    );
}
