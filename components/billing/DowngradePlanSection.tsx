"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPlanLabel, type CommercialPlanKey } from "@/lib/billing/planCatalog";

type Member = {
    user_id: string;
    role: string;
    email: string | null;
};

type Props = {
    currentPlan: CommercialPlanKey;
    pendingPlanKey: string | null | undefined;
    pendingPlanChangeAt: string | null | undefined;
    nextBillingAt: string | null | undefined;
    planSaving: boolean;
    onScheduled: () => Promise<void>;
    onError: (msg: string) => void;
};

export function DowngradePlanSection({
    currentPlan,
    pendingPlanKey,
    pendingPlanChangeAt,
    nextBillingAt,
    planSaving,
    onScheduled,
    onError,
}: Props) {
    const [target, setTarget] = useState<CommercialPlanKey | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [included, setIncluded] = useState(1);
    const [keep, setKeep] = useState<Set<string>>(new Set());
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [saving, setSaving] = useState(false);

    const targets: CommercialPlanKey[] =
        currentPlan === "market"
            ? ["pro", "essencial"]
            : currentPlan === "pro"
              ? ["essencial"]
              : [];

    const loadMembers = useCallback(
        async (plan: CommercialPlanKey) => {
            setLoadingMembers(true);
            try {
                const res = await fetch(
                    `/api/billing/members-for-downgrade?plan=${encodeURIComponent(plan)}`,
                    { credentials: "include" }
                );
                const json = (await res.json().catch(() => ({}))) as {
                    error?: string;
                    members?: Member[];
                    target_included_seats?: number;
                };
                if (!res.ok) {
                    onError(json.error ?? "Não foi possível listar usuários.");
                    return;
                }
                const list = json.members ?? [];
                setMembers(list);
                const seats = Math.max(1, Number(json.target_included_seats ?? 1));
                setIncluded(seats);
                const admins = list.filter(
                    (m) => m.role === "owner" || m.role === "admin"
                );
                const initial = new Set<string>();
                if (admins[0]) initial.add(admins[0].user_id);
                for (const m of list) {
                    if (initial.size >= seats) break;
                    initial.add(m.user_id);
                }
                setKeep(initial);
            } finally {
                setLoadingMembers(false);
            }
        },
        [onError]
    );

    useEffect(() => {
        if (target) void loadMembers(target);
    }, [target, loadMembers]);

    async function cancelPending() {
        setCancelling(true);
        try {
            const res = await fetch("/api/billing/pending-plan-change", {
                method: "DELETE",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                onError((json as { error?: string }).error ?? "Não foi possível cancelar.");
                return;
            }
            await onScheduled();
        } finally {
            setCancelling(false);
        }
    }

    async function confirmSchedule() {
        if (!target) return;
        setSaving(true);
        try {
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    plan: target,
                    keep_user_ids: [...keep],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                onError((json as { error?: string }).error ?? "Não foi possível agendar.");
                return;
            }
            setTarget(null);
            await onScheduled();
        } finally {
            setSaving(false);
        }
    }

    function toggleKeep(userId: string) {
        setKeep((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else {
                if (next.size >= included) return prev;
                next.add(userId);
            }
            return next;
        });
    }

    if (targets.length === 0 && !pendingPlanKey) return null;

    const pendingLabel = pendingPlanKey ? getPlanLabel(pendingPlanKey) : null;
    const whenLabel = pendingPlanChangeAt
        ? new Date(pendingPlanChangeAt).toLocaleDateString("pt-BR")
        : nextBillingAt
          ? new Date(nextBillingAt).toLocaleDateString("pt-BR")
          : "fim do ciclo";

    return (
        <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Downgrade de plano
            </p>
            <p className="text-xs text-zinc-500">
                A mudança vale no fim do ciclo atual. Até lá você mantém o plano vigente. Se houver
                mais usuários que o destino permite, escolha quem permanece (≥1 admin/owner).
            </p>

            {pendingPlanKey ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Agendado: {pendingLabel} em {whenLabel}
                    </p>
                    <button
                        type="button"
                        disabled={cancelling || planSaving}
                        onClick={() => void cancelPending()}
                        className="mt-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                    >
                        {cancelling ? "Cancelando…" : "Cancelar agendamento"}
                    </button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {targets.map((t) => (
                        <button
                            key={t}
                            type="button"
                            disabled={planSaving}
                            onClick={() => setTarget(t)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                target === t
                                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                    : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                            }`}
                        >
                            Ir para {getPlanLabel(t)}
                        </button>
                    ))}
                </div>
            )}

            {target && !pendingPlanKey ? (
                <div className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Manter até {included} usuário(s) no {getPlanLabel(target)}
                    </p>
                    {loadingMembers ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    ) : (
                        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                            {members.map((m) => (
                                <li key={m.user_id} className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={keep.has(m.user_id)}
                                        onChange={() => toggleKeep(m.user_id)}
                                        disabled={
                                            !keep.has(m.user_id) && keep.size >= included
                                        }
                                    />
                                    <span>
                                        {m.email ?? m.user_id.slice(0, 8)}
                                        <span className="ml-1 text-zinc-400">({m.role})</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                        <button
                            type="button"
                            disabled={saving || loadingMembers}
                            onClick={() => void confirmSchedule()}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                        >
                            {saving ? "Agendando…" : `Agendar para ${whenLabel}`}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTarget(null)}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-zinc-600"
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
