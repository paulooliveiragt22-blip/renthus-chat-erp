"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, Loader2 } from "lucide-react";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";

type Props = {
    /** Uma feature obrigatória (ou use anyOfFeatureKeys). */
    featureKey?: string;
    /** Libera se tiver qualquer uma destas features. */
    anyOfFeatureKeys?: string[];
    title: string;
    description: string;
    /** Plano sugerido no CTA (só texto). */
    requiredPlanLabel?: string;
    children: ReactNode;
};

export default function PlanFeatureGate({
    featureKey,
    anyOfFeatureKeys,
    title,
    description,
    requiredPlanLabel = "Pro ou Market",
    children,
}: Props) {
    const { loading, has } = usePlanFeatures();

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center gap-2 rounded-xl border border-zinc-100 px-4 py-10 text-sm text-zinc-500 dark:border-zinc-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando plano…
            </div>
        );
    }

    const allowed = anyOfFeatureKeys?.length
        ? anyOfFeatureKeys.some((k) => has(k))
        : featureKey
          ? has(featureKey)
          : false;
    if (allowed) return <>{children}</>;

    return (
        <div className="rounded-xl border border-dashed border-violet-300/80 bg-violet-50/60 p-6 dark:border-violet-800 dark:bg-violet-950/20">
            <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-violet-100 p-2 dark:bg-violet-900/40">
                    <Lock className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
                    <p className="mt-2 text-xs text-violet-800 dark:text-violet-200">
                        Disponível no plano {requiredPlanLabel}.
                    </p>
                    <Link
                        href="/configuracoes?tab=plano"
                        className="mt-3 inline-flex rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                    >
                        Ver planos e upgrade
                    </Link>
                </div>
            </div>
        </div>
    );
}
