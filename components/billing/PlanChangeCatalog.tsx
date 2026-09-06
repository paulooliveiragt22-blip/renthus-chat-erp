"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
    getPlanLabel,
    planRank,
    type CommercialPlanKey,
    PLAN_ORDER,
} from "@/lib/billing/planCatalog";
import { PLAN_CARD_ACCENT } from "@/lib/billing/planOfferUi";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    BillingPeriodToggle,
    type BillingPeriodValue,
} from "@/components/billing/BillingPeriodToggle";

type Member = {
    user_id: string;
    role: string;
    email: string | null;
};

type Prices = { essencial?: number; pro?: number; market?: number };

type ViewPeriod = BillingPeriodValue;

type Props = {
    currentPlan: CommercialPlanKey;
    status: string;
    /** Ciclo atual da assinatura (month|year). */
    billingPeriod?: string | null;
    pendingPlanKey?: string | null;
    pendingPlanChangeAt?: string | null;
    nextBillingAt?: string | null;
    prices: Prices;
    /** Preço anual à vista por plano (R2-3). */
    yearlyPrices?: Prices;
    /** % canônico do anual (plans.yearly_discount_*) — mesma fonte do /signup. */
    yearlySavingsPercent?: Prices;
    planSaving: boolean;
    onUpgradeOrTrial: (plan: CommercialPlanKey) => Promise<void> | void;
    onReload: () => Promise<void>;
    onError: (msg: string) => void;
    onSuccess?: (msg: string) => void;
    /** Never-paid: persistir month|year no banco ao acionar o toggle. */
    onPrepayPeriodChange?: (period: ViewPeriod) => Promise<void> | void;
    /** Após seleção que gera cobrança (upgrade / migração anual). */
    onCheckoutNeeded?: () => void;
    /** Checkout inicial (/plano/pagar): seleção livre, sem upgrade/downgrade. */
    checkoutMode?: boolean;
    /** Sem last_paid_at — nunca tratar como upgrade/downgrade de assinante pago. */
    neverPaid?: boolean;
    /** Paywall / 1ª cobrança — desliga migrar anual, upgrade PIX etc. */
    initialCheckout?: boolean;
};

function brl(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** % de desconto do anual vs 12× mensal. 0 se não houver ganho. */
function yearlyDiscountPct(monthlyBrl: number, yearlyBrl: number) {
    const full = monthlyBrl * 12;
    if (full <= 0 || yearlyBrl <= 0 || yearlyBrl >= full) return 0;
    return Math.round((1 - yearlyBrl / full) * 100);
}

const BLURBS: Record<CommercialPlanKey, string> = {
    essencial: "Agente WhatsApp + cardápio + PDV",
    pro: "PDV + estoque + financeiro + impressão",
    market: "Pro + iFood/Aiqfome + omni + mesa",
};

export function PlanChangeCatalog({
    currentPlan,
    status,
    billingPeriod,
    pendingPlanKey,
    pendingPlanChangeAt,
    nextBillingAt,
    prices,
    yearlyPrices,
    yearlySavingsPercent,
    planSaving,
    onUpgradeOrTrial,
    onReload,
    onError,
    onSuccess,
    onPrepayPeriodChange,
    onCheckoutNeeded,
    checkoutMode = false,
    neverPaid = false,
    initialCheckout = false,
}: Props) {
    const isAnnualSub = String(billingPeriod ?? "month").toLowerCase() === "year";
    const [viewPeriod, setViewPeriod] = useState<ViewPeriod>(isAnnualSub ? "year" : "month");
    const [switching, setSwitching] = useState(false);
    const [downgradeTo, setDowngradeTo] = useState<CommercialPlanKey | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [included, setIncluded] = useState(1);
    const [keep, setKeep] = useState<Set<string>>(new Set());
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [saving, setSaving] = useState(false);
    const [cancelling, setCancelling] = useState(false);

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
                const admins = list.filter((m) => m.role === "owner" || m.role === "admin");
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
        if (downgradeTo) void loadMembers(downgradeTo);
    }, [downgradeTo, loadMembers]);

    useEffect(() => {
        setViewPeriod(isAnnualSub ? "year" : "month");
    }, [isAnnualSub]);

    const isPrepayFlow =
        initialCheckout ||
        neverPaid ||
        checkoutMode ||
        status === "pending_payment" ||
        status === "pending_setup" ||
        (status === "trial" && Boolean(onPrepayPeriodChange));
    const isPrepay = isPrepayFlow;
    const canSwitchToAnnual =
        !initialCheckout &&
        !neverPaid &&
        !checkoutMode &&
        status === "active" &&
        !isAnnualSub;

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
            await onReload();
        } finally {
            setCancelling(false);
        }
    }

    async function confirmDowngrade() {
        if (!downgradeTo) return;
        setSaving(true);
        try {
            const toAnnualImmediate = viewPeriod === "year" && !isAnnualSub;
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    plan: downgradeTo,
                    keep_user_ids: [...keep],
                    to_annual: toAnnualImmediate,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                onError((json as { error?: string }).error ?? "Não foi possível confirmar.");
                return;
            }
            setDowngradeTo(null);
            if (typeof json.message === "string" && json.message.trim()) {
                onSuccess?.(json.message);
            }
            await onReload();
            if (
                (json as { action?: string }).action === "downgrade_to_annual_quoted" ||
                (json as { action?: string }).action === "upgrade_to_annual_quoted"
            ) {
                onCheckoutNeeded?.();
            }
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

    async function startUpgradeCheckout(key: CommercialPlanKey) {
        if (initialCheckout || checkoutMode || neverPaid || isPrepay) {
            void onUpgradeOrTrial(key);
            return;
        }
        setSaving(true);
        try {
            const toAnnual = viewPeriod === "year" && !isAnnualSub;
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan: key, to_annual: toAnnual }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                action?: string;
                message?: string;
            };
            if (!res.ok) {
                onError(json.error ?? "Não foi possível iniciar o upgrade.");
                return;
            }
            if (typeof json.message === "string" && json.message.trim()) {
                onSuccess?.(json.message);
            }
            await onReload();
            if (
                json.action === "upgrade_quoted" ||
                json.action === "upgrade_to_annual_quoted" ||
                json.action === "downgrade_to_annual_quoted"
            ) {
                onCheckoutNeeded?.();
            }
        } finally {
            setSaving(false);
        }
    }

    async function startPeriodSwitch() {
        if (initialCheckout || checkoutMode || neverPaid || isPrepay) {
            onError(
                "Escolha o ciclo anual no toggle acima. A migração mensal→anual só vale após a 1ª mensalidade paga."
            );
            return;
        }
        setSwitching(true);
        try {
            const res = await fetch("/api/billing/switch-period", {
                method: "POST",
                credentials: "include",
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                action?: string;
                message?: string;
            };
            if (!res.ok) {
                onError(json.error ?? "Não foi possível migrar para o anual.");
                return;
            }
            if (typeof json.message === "string" && json.message.trim()) {
                onSuccess?.(json.message);
            }
            await onReload();
            if (
                json.action === "period_switch_quoted" ||
                json.action === "period_switch_pending"
            ) {
                onCheckoutNeeded?.();
            }
        } finally {
            setSwitching(false);
        }
    }

    function onSelectPlan(key: CommercialPlanKey) {
        if (key === currentPlan) return;
        if (initialCheckout || isPrepay || checkoutMode || neverPaid) {
            void onUpgradeOrTrial(key);
            return;
        }
        const rankDiff = planRank(key) - planRank(currentPlan);
        if (status === "overdue") {
            onError("Regularize o pagamento antes de alterar o plano.");
            return;
        }
        if (status === "trial") {
            void onUpgradeOrTrial(key);
            return;
        }
        if (rankDiff > 0 && status === "active") {
            void startUpgradeCheckout(key);
            return;
        }
        if (rankDiff < 0 && status === "active") {
            setDowngradeTo(key);
            return;
        }
        onError("Alteração de plano não disponível nesta situação.");
    }

    const whenLabel = pendingPlanChangeAt
        ? new Date(pendingPlanChangeAt).toLocaleDateString("pt-BR")
        : nextBillingAt
          ? new Date(nextBillingAt).toLocaleDateString("pt-BR")
          : "fim do ciclo";

    const title = checkoutMode
        ? "Escolha seu plano"
        : status === "trial"
          ? "Escolha do plano"
          : "Planos disponíveis";
    const subtitle = checkoutMode
        ? "Troque plano e ciclo (mensal/anual) antes de pagar. O valor do checkout atualiza automaticamente."
        : status === "trial"
          ? "Durante o teste você pode trocar o plano a qualquer momento."
          : viewPeriod === "year"
            ? isAnnualSub
                ? "Você está no plano anual. Upgrade vale na hora; downgrade só no fim do ciclo anual."
                : "Mensal → anual: migração imediata com abatimento do mês. Downgrade mensal continua no fim do ciclo."
            : "Upgrade vale na hora. Downgrade no mesmo ciclo (mensal) conclui no fim do período.";

    const maxYearlyPct = Math.max(
        0,
        ...PLAN_ORDER.map((k) => {
            const fromDb = yearlySavingsPercent?.[k];
            if (typeof fromDb === "number" && fromDb > 0) return fromDb;
            return yearlyDiscountPct(prices[k] ?? 0, yearlyPrices?.[k] ?? 0);
        })
    );

    async function selectViewPeriod(next: ViewPeriod) {
        if (next === viewPeriod) return;
        setViewPeriod(next);
        if (isPrepay && onPrepayPeriodChange) {
            await onPrepayPeriodChange(next);
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-col items-center gap-3 sm:items-stretch">
                <div className="text-center sm:text-left">
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                        {title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
                </div>
                <div className="flex justify-center">
                    <BillingPeriodToggle
                        value={viewPeriod}
                        onValueChange={(next) => void selectViewPeriod(next)}
                        yearlyHint={
                            maxYearlyPct > 0 ? `economize até ${maxYearlyPct}%` : null
                        }
                        disabled={planSaving || switching || saving}
                    />
                </div>
            </div>

            {pendingPlanKey ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Migração para {getPlanLabel(pendingPlanKey)} confirmada — conclui em{" "}
                        {whenLabel}
                    </p>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                        A troca de plano inferior no mesmo ciclo só vale no fim do período atual
                        (vencimento {whenLabel}).
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={cancelling || planSaving}
                        onClick={() => void cancelPending()}
                        className="mt-2"
                    >
                        {cancelling ? "Cancelando…" : "Cancelar migração"}
                    </Button>
                </div>
            ) : null}

            <div
                className={`grid gap-3 ${checkoutMode ? "grid-cols-1" : "sm:grid-cols-3"}`}
            >
                {PLAN_ORDER.map((key) => {
                    const active = key === currentPlan;
                    const pending = pendingPlanKey === key;
                    const monthlyPrice = prices[key] ?? 0;
                    const yearPrice = yearlyPrices?.[key] ?? 0;
                    const showYear = viewPeriod === "year" && yearPrice > 0;
                    const yearPerMonth = showYear ? yearPrice / 12 : 0;
                    const yearPct = showYear
                        ? yearlySavingsPercent?.[key] && yearlySavingsPercent[key]! > 0
                            ? yearlySavingsPercent[key]!
                            : yearlyDiscountPct(monthlyPrice, yearPrice)
                        : 0;
                    const higher = planRank(key) > planRank(currentPlan);
                    const lower = planRank(key) < planRank(currentPlan);
                    // Ação anual específica: plano atual, sub mensal ativa, view anual.
                    const isMigrateCta =
                        !initialCheckout &&
                        !checkoutMode &&
                        !neverPaid &&
                        !isPrepay &&
                        active &&
                        showYear &&
                        canSwitchToAnnual;
                    let cta = "Selecionar";
                    if (isMigrateCta) cta = switching ? "Preparando…" : "Migrar para anual";
                    else if (active && (checkoutMode || isPrepay || neverPaid))
                        cta =
                            viewPeriod === "year"
                                ? "Plano anual selecionado"
                                : "Plano mensal selecionado";
                    else if (active) cta = isAnnualSub ? "Plano anual atual" : "Plano atual";
                    else if (checkoutMode || isPrepay || neverPaid || status === "trial")
                        cta = "Escolher este plano";
                    else if (higher && showYear && !isAnnualSub)
                        cta = saving ? "Cotando…" : "Upgrade para anual";
                    else if (higher) cta = "Fazer upgrade";
                    else if (lower && showYear && !isAnnualSub)
                        cta = "Migrar para anual";
                    else if (lower) cta = "Confirmar migração";
                    else cta = "Indisponível";
                    const btnDisabled =
                        status === "overdue"
                            ? true
                            : initialCheckout || checkoutMode || isPrepay || neverPaid
                              ? planSaving || active
                              : isMigrateCta
                                ? planSaving || switching
                                : planSaving ||
                                  saving ||
                                  active ||
                                  (lower && status !== "active");

                    return (
                        <div
                            key={key}
                            className={`rounded-xl border-2 p-4 ${
                                active
                                    ? "border-primary bg-primary/5 dark:border-primary dark:bg-primary/10"
                                    : pending
                                      ? "border-amber-400 bg-amber-50/80 dark:border-amber-600 dark:bg-amber-950/20"
                                      : "border-border"
                            }`}
                        >
                            {key === "pro" ? (
                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                                    Mais popular
                                </p>
                            ) : null}
                            <p className="font-bold text-zinc-900 dark:text-zinc-100">
                                {getPlanLabel(key)}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">{BLURBS[key]}</p>
                            {showYear ? (
                                <>
                                    <p className="mt-2 text-xs text-zinc-400 line-through">
                                        De {brl(monthlyPrice)}/mês
                                    </p>
                                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                        {brl(yearPerMonth)}
                                        <span className="text-sm font-semibold text-zinc-500">
                                            /mês
                                        </span>
                                    </p>
                                    <p
                                        className="mt-0.5 text-[11px] font-semibold"
                                        style={{ color: PLAN_CARD_ACCENT }}
                                    >
                                        {brl(yearPrice)}/ano à vista
                                        {yearPct > 0 ? ` · economize ${yearPct}%` : ""}
                                    </p>
                                </>
                            ) : (
                                <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                    {brl(monthlyPrice)}
                                    <span className="text-sm font-semibold text-zinc-500">
                                        /mês
                                    </span>
                                </p>
                            )}
                            {pending ? (
                                <p className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                    Migração em {whenLabel}
                                </p>
                            ) : null}
                            <Button
                                type="button"
                                disabled={btnDisabled}
                                onClick={() =>
                                    isMigrateCta
                                        ? void startPeriodSwitch()
                                        : onSelectPlan(key)
                                }
                                className="mt-3 w-full bg-[#16364d] text-white hover:bg-[#1f4a68]"
                            >
                                {isMigrateCta && switching ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                        Preparando…
                                    </>
                                ) : (
                                    cta
                                )}
                            </Button>
                        </div>
                    );
                })}
            </div>

            <Dialog open={downgradeTo != null} onOpenChange={(o) => !o && setDowngradeTo(null)}>
                <DialogContent className="max-w-xl overflow-x-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {downgradeTo && viewPeriod === "year" && !isAnnualSub
                                ? `Migrar para ${getPlanLabel(downgradeTo)} anual`
                                : downgradeTo
                                  ? `Confirmar migração para ${getPlanLabel(downgradeTo)}`
                                  : "Confirmar migração"}
                        </DialogTitle>
                        <DialogDescription>
                            {viewPeriod === "year" && !isAnnualSub
                                ? "Vale na hora após o pagamento (anual − crédito do mês)."
                                : `A migração será concluída no final do ciclo do plano atual (vencimento ${whenLabel}).`}
                        </DialogDescription>
                    </DialogHeader>
                    <p className="text-xs text-zinc-500">
                        Escolha até {included} usuário(s) para manter (≥1 admin/owner).
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
                                        disabled={!keep.has(m.user_id) && keep.size >= included}
                                    />
                                    <span>
                                        {m.email ?? m.user_id.slice(0, 8)}
                                        <span className="ml-1 text-zinc-400">({m.role})</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDowngradeTo(null)}>
                            Fechar
                        </Button>
                        <Button
                            type="button"
                            disabled={saving || loadingMembers}
                            onClick={() => void confirmDowngrade()}
                        >
                            {saving
                                ? "Confirmando…"
                                : viewPeriod === "year" && !isAnnualSub
                                  ? "Continuar para pagamento"
                                  : "Confirmar migração"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
