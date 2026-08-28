"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import type { BillingStatusJson } from "@/lib/billing/planBillingTypes";

type BannerKind = "trial" | "overdue" | "blocked" | "pending" | null;

function resolveBanner(data: BillingStatusJson): BannerKind {
    const st = data.pagarme_subscription?.status ?? "";
    if (st === "blocked" || data.is_blocked) return "blocked";
    if (st === "pending_payment" || st === "pending_setup") return "pending";
    if (st === "overdue") return "overdue";
    if (st === "trial") {
        const ends = data.pagarme_subscription?.trial_ends_at;
        if (ends && new Date(ends).getTime() > Date.now()) return "trial";
    }
    return null;
}

export default function BillingStatusBanner() {
    const [kind, setKind] = useState<BannerKind>(null);
    const [trialEnds, setTrialEnds] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/billing/status", {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!res.ok) return;
                const json = (await res.json()) as BillingStatusJson;
                if (cancelled) return;
                setKind(resolveBanner(json));
                setTrialEnds(json.pagarme_subscription?.trial_ends_at ?? null);
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (!kind) return null;

    const trialLabel =
        trialEnds &&
        new Date(trialEnds).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
        });

    if (kind === "trial") {
        return (
            <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-center text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
                <Clock className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                Período de teste{trialLabel ? ` até ${trialLabel}` : ""}.{" "}
                <Link href="/plano" className="font-semibold underline underline-offset-2">
                    Ver plano
                </Link>
            </div>
        );
    }

    if (kind === "overdue") {
        return (
            <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                Mensalidade em aberto.{" "}
                <Link href="/plano/pagar" className="font-bold underline underline-offset-2">
                    Pagar agora
                </Link>
            </div>
        );
    }

    const payHref = kind === "blocked" ? "/plano/bloqueado" : "/plano/pagar";
    const msg =
        kind === "blocked"
            ? "Acesso suspenso — regularize o pagamento."
            : "Pagamento pendente para liberar o sistema.";

    return (
        <div className="border-b border-red-300 bg-red-50 px-4 py-2 text-center text-sm font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            <AlertTriangle className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            {msg}{" "}
            <Link href={payHref} className="font-bold underline underline-offset-2">
                Ir para pagamento
            </Link>
        </div>
    );
}
