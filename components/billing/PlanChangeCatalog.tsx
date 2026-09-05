"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
    getPlanLabel,
    planRank,
    type CommercialPlanKey,
    PLAN_ORDER,
} from "@/lib/billing/planCatalog";
import { PLAN_CARD_ACCENT, PLAN_TOGGLE_ACCENT } from "@/lib/billing/planOfferUi";

type Member = {
    user_id: string;
    role: string;
    email: string | null;
};

type Prices = { essencial?: number; pro?: number; market?: number };

type ViewPeriod = "month" | "year";

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
    /** Never-paid: persistir month|year no banco ao acionar o toggle. */
    onPrepayPeriodChange?: (period: ViewPeriod) => Promise<void> | void;
    /** Checkout inicial (/plano/pagar): seleção livre, sem upgrade/downgrade. */
    checkoutMode?: boolean;
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
    essencial: "WhatsApp + cardápio + IA",
    pro: "ERP + impressão + IA",
    market: "Pro + iFood/Aiqfome + omni",
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
    onPrepayPeriodChange,
    checkoutMode = false,
}: Props) {
    const isAnnualSub = String(billingPeriod ?? "month").toLowerCase() === "year";
    const [viewPeriod, setViewPeriod] = useState<ViewPeriod>(isAnnualSub ? "year" : "month");
    const [switchPix, setSwitchPix] = useState<{
        plan: string;
        amount_brl: number;
        annual_cents: number;
        credit_cents: number;
        pix_qr_code: string | null;
        pix_url: string | null;
        message?: string;
    } | null>(null);
    const [switching, setSwitching] = useState(false);
    const [downgradeTo, setDowngradeTo] = useState<CommercialPlanKey | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [included, setIncluded] = useState(1);
    const [keep, setKeep] = useState<Set<string>>(new Set());
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [saving, setSaving] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [upgradePix, setUpgradePix] = useState<{
        to_plan: string;
        from_plan: string;
        amount_brl: number;
        pix_qr_code: string | null;
        pix_url: string | null;
        message?: string;
    } | null>(null);

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
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    plan: downgradeTo,
                    keep_user_ids: [...keep],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                onError((json as { error?: string }).error ?? "Não foi possível agendar.");
                return;
            }
            setDowngradeTo(null);
            await onReload();
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
        setSaving(true);
        setUpgradePix(null);
        try {
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan: key }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                action?: string;
                to_plan?: string;
                from_plan?: string;
                amount_brl?: number;
                pix_qr_code?: string | null;
                pix_url?: string | null;
                message?: string;
            };
            if (!res.ok) {
                onError(json.error ?? "Não foi possível iniciar o upgrade.");
                return;
            }
            if (json.action === "upgrade_checkout") {
                setUpgradePix({
                    to_plan: String(json.to_plan ?? key),
                    from_plan: String(json.from_plan ?? currentPlan),
                    amount_brl: Number(json.amount_brl ?? 0),
                    pix_qr_code: json.pix_qr_code ?? null,
                    pix_url: json.pix_url ?? null,
                    message: json.message,
                });
                return;
            }
            await onReload();
        } finally {
            setSaving(false);
        }
    }

    async function startPeriodSwitch() {
        setSwitching(true);
        setSwitchPix(null);
        try {
            const res = await fetch("/api/billing/switch-period", {
                method: "POST",
                credentials: "include",
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                action?: string;
                plan?: string;
                amount_brl?: number;
                annual_cents?: number;
                credit_cents?: number;
                pix_qr_code?: string | null;
                pix_url?: string | null;
                message?: string;
            };
            if (!res.ok) {
                onError(json.error ?? "Não foi possível migrar para o anual.");
                return;
            }
            if (json.action === "period_switch_checkout") {
                setSwitchPix({
                    plan: String(json.plan ?? currentPlan),
                    amount_brl: Number(json.amount_brl ?? 0),
                    annual_cents: Number(json.annual_cents ?? 0),
                    credit_cents: Number(json.credit_cents ?? 0),
                    pix_qr_code: json.pix_qr_code ?? null,
                    pix_url: json.pix_url ?? null,
                    message: json.message,
                });
                return;
            }
            await onReload();
        } finally {
            setSwitching(false);
        }
    }

    function onSelectPlan(key: CommercialPlanKey) {
        if (key === currentPlan) return;
        if (isPrepay || checkoutMode) {
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
                ? "Você está no plano anual. Upgrade vale na hora; downgrade no fim do ciclo."
                : "Plano anual à vista com desconto. Ao migrar, abatemos o mês já pago."
            : "Upgrade vale na hora. Downgrade agenda para o fim do ciclo atual.";

    const canSwitchToAnnual = status === "active" && !isAnnualSub;
    const isPrepay =
        status === "pending_payment" ||
        status === "pending_setup" ||
        (status === "trial" && Boolean(onPrepayPeriodChange));
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
                    <div
                        className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-800"
                        role="tablist"
                        aria-label="Ciclo de cobrança"
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewPeriod === "month"}
                            onClick={() => void selectViewPeriod("month")}
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                                viewPeriod === "month"
                                    ? "bg-[#57ff8f] text-[#16364D] shadow-sm"
                                    : "text-zinc-500"
                            }`}
                        >
                            Mensal
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewPeriod === "year"}
                            onClick={() => void selectViewPeriod("year")}
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                                viewPeriod === "year"
                                    ? "bg-[#57ff8f] text-[#16364D] shadow-sm"
                                    : "text-zinc-500"
                            }`}
                        >
                            Anual
                            {maxYearlyPct > 0 ? (
                                <span
                                    className="ml-1 text-[10px] font-bold"
                                    style={{
                                        color:
                                            viewPeriod === "year" ? "#16364D" : PLAN_TOGGLE_ACCENT,
                                        opacity: 0.85,
                                    }}
                                >
                                    economize até {maxYearlyPct}%
                                </span>
                            ) : null}
                        </button>
                    </div>
                </div>
            </div>

            {pendingPlanKey ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Downgrade agendado: {getPlanLabel(pendingPlanKey)} em {whenLabel}
                    </p>
                    <button
                        type="button"
                        disabled={cancelling || planSaving}
                        onClick={() => void cancelPending()}
                        className="mt-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-white disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                    >
                        {cancelling ? "Cancelando…" : "Cancelar agendamento"}
                    </button>
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
                        !checkoutMode && active && showYear && canSwitchToAnnual;
                    let cta = "Selecionar";
                    if (isMigrateCta) cta = switching ? "Gerando PIX…" : "Migrar para anual";
                    else if (active && (checkoutMode || isPrepay))
                        cta =
                            viewPeriod === "year"
                                ? "Plano anual selecionado"
                                : "Plano mensal selecionado";
                    else if (active) cta = isAnnualSub ? "Plano anual atual" : "Plano atual";
                    else if (checkoutMode || isPrepay || status === "trial")
                        cta = "Escolher este plano";
                    else if (higher) cta = "Fazer upgrade";
                    else if (lower) cta = "Agendar downgrade";
                    else cta = "Indisponível";
                    const btnDisabled = checkoutMode || isPrepay
                        ? planSaving || active
                        : isMigrateCta
                          ? planSaving || switching
                          : planSaving || active || (lower && status !== "active");

                    return (
                        <div
                            key={key}
                            className={`rounded-xl border-2 p-4 ${
                                active
                                    ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
                                    : pending
                                      ? "border-amber-400 bg-amber-50/80 dark:border-amber-600 dark:bg-amber-950/20"
                                      : "border-zinc-200 dark:border-zinc-700"
                            }`}
                        >
                            {key === "pro" ? (
                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-600">
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
                                    Agendado para {whenLabel}
                                </p>
                            ) : null}
                            <button
                                type="button"
                                disabled={btnDisabled}
                                onClick={() =>
                                    isMigrateCta
                                        ? void startPeriodSwitch()
                                        : onSelectPlan(key)
                                }
                                className="mt-3 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-default disabled:opacity-50"
                            >
                                {cta}
                            </button>
                        </div>
                    );
                })}
            </div>

            {switchPix ? (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        Migrar {getPlanLabel(switchPix.plan)} para o plano anual
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        Anual à vista {brl(switchPix.annual_cents / 100)} − crédito do mês pago{" "}
                        {brl(switchPix.credit_cents / 100)} ={" "}
                        <span className="font-semibold">{brl(switchPix.amount_brl)}</span>. Após o
                        pagamento a renovação passa a ser anual (reinicia por 12 meses).
                    </p>
                    {switchPix.pix_qr_code ? (
                        <p className="break-all rounded-lg bg-white p-2 font-mono text-[10px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                            {switchPix.pix_qr_code}
                        </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {switchPix.pix_url ? (
                            <a
                                href={switchPix.pix_url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                            >
                                Abrir PIX
                            </a>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                void navigator.clipboard.writeText(
                                    switchPix.pix_qr_code ?? switchPix.pix_url ?? ""
                                );
                            }}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-zinc-600"
                        >
                            Copiar código
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setSwitchPix(null);
                                void onReload();
                            }}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-zinc-600"
                        >
                            Já paguei / fechar
                        </button>
                    </div>
                </div>
            ) : null}

            {upgradePix ? (
                <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        Upgrade {getPlanLabel(upgradePix.from_plan)} →{" "}
                        {getPlanLabel(upgradePix.to_plan)}
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        Prorata até a renovação:{" "}
                        <span className="font-semibold">
                            {upgradePix.amount_brl.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                            })}
                        </span>
                        . O plano sobe após o pagamento.
                    </p>
                    {upgradePix.pix_qr_code ? (
                        <p className="break-all rounded-lg bg-white p-2 font-mono text-[10px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                            {upgradePix.pix_qr_code}
                        </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {upgradePix.pix_url ? (
                            <a
                                href={upgradePix.pix_url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white"
                            >
                                Abrir PIX
                            </a>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                void navigator.clipboard.writeText(
                                    upgradePix.pix_qr_code ?? upgradePix.pix_url ?? ""
                                );
                            }}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-zinc-600"
                        >
                            Copiar código
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setUpgradePix(null);
                                void onReload();
                            }}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-zinc-600"
                        >
                            Já paguei / fechar
                        </button>
                    </div>
                </div>
            ) : null}

            {downgradeTo ? (
                <div className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        Agendar {getPlanLabel(downgradeTo)}
                    </p>
                    <p className="text-xs text-zinc-500">
                        Vale em {whenLabel}. Escolha até {included} usuário(s) para manter (≥1
                        admin/owner).
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
                    <div className="flex flex-wrap gap-2 pt-1">
                        <button
                            type="button"
                            disabled={saving || loadingMembers}
                            onClick={() => void confirmDowngrade()}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                        >
                            {saving ? "Agendando…" : "Confirmar agendamento"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setDowngradeTo(null)}
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
