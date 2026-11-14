"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { BillingPeriodToggle, type BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";
import { PLAN_CATALOG, PLAN_ORDER, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { yearlySavingsPercent } from "@/lib/billing/yearlyFromDiscount";
import {
    ANNUAL_LEAFLETS,
    PLAN_CARD_PITCH,
    PLAN_FEATURE_BLURBS,
    PLAN_GUARANTEE,
} from "@/lib/marketing/copy";
import { formatBrlFromCents } from "@/lib/marketing/marketplaceFees";
import { accountHref } from "@/lib/marketing/hosts";
import { ChannelSavings } from "@/components/marketing/ChannelSavings";
import { StartPolicyLine } from "@/components/marketing/StartPolicyLine";
import { cn } from "@/lib/utils";

type SignupPlanCard = {
    key: CommercialPlanKey;
    name: string;
    popular: boolean;
    listMonthlyCents: number;
    offerMonthlyCents: number;
    listYearlyCents: number | null;
    yearlySavingsPercent: number;
    promoLabel: string | null;
};

function catalogFallbackPlans(): SignupPlanCard[] {
    return PLAN_ORDER.map((key) => {
        const catalog = PLAN_CATALOG[key];
        return {
            key,
            name: catalog.name,
            popular: Boolean(catalog.popular),
            listMonthlyCents: catalog.monthlyPriceCents,
            offerMonthlyCents: catalog.monthlyPriceCents,
            listYearlyCents: catalog.yearlyPriceCents ?? null,
            yearlySavingsPercent: yearlySavingsPercent(
                catalog.monthlyPriceCents,
                catalog.yearlyPriceCents
            ),
            promoLabel: null,
        };
    });
}

function yearlyPerMonthCents(yearlyCents: number) {
    return Math.round(yearlyCents / 12);
}

function includesAnnualLeaflets(planKey: CommercialPlanKey) {
    return planKey === "pro" || planKey === "market";
}

type PlanShowcaseProps = {
    linkToApp?: boolean;
    children?: ReactNode;
};

export function PlanShowcase({ linkToApp = false, children }: PlanShowcaseProps) {
    const [billingPeriod, setBillingPeriod] = useState<BillingPeriodValue>("year");
    const [plans, setPlans] = useState<SignupPlanCard[]>(() => catalogFallbackPlans());

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/public-plans", { cache: "no-store" })
            .then((response) => response.json())
            .then(
                (data: {
                    plans?: Array<{
                        key: string;
                        name: string;
                        list_monthly_cents: number;
                        offer_monthly_cents: number;
                        list_yearly_cents: number | null;
                        yearly_savings_percent?: number;
                        popular: boolean;
                        promo: { label_de_por: string } | null;
                    }>;
                }) => {
                    if (cancelled || !Array.isArray(data.plans) || data.plans.length === 0) return;
                    const next: SignupPlanCard[] = [];
                    for (const key of PLAN_ORDER) {
                        const row = data.plans.find((plan) => plan.key === key);
                        const catalog = PLAN_CATALOG[key];
                        if (!row) {
                            const fallback = catalogFallbackPlans().find((plan) => plan.key === key);
                            if (fallback) next.push(fallback);
                            continue;
                        }
                        next.push({
                            key,
                            name: row.name || catalog.name,
                            popular: Boolean(row.popular ?? catalog.popular),
                            listMonthlyCents: row.list_monthly_cents,
                            offerMonthlyCents: row.offer_monthly_cents,
                            listYearlyCents:
                                typeof row.list_yearly_cents === "number" && row.list_yearly_cents > 0
                                    ? row.list_yearly_cents
                                    : (catalog.yearlyPriceCents ?? null),
                            yearlySavingsPercent:
                                typeof row.yearly_savings_percent === "number" &&
                                row.yearly_savings_percent > 0
                                    ? row.yearly_savings_percent
                                    : yearlySavingsPercent(
                                          row.list_monthly_cents,
                                          row.list_yearly_cents ?? catalog.yearlyPriceCents
                                      ),
                            promoLabel: row.promo?.label_de_por ?? null,
                        });
                    }
                    setPlans(next);
                }
            )
            .catch(() => {
                /* mantém o catálogo */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const proPlan = plans.find((plan) => plan.key === "pro");
    const proListCents = proPlan?.listMonthlyCents ?? PLAN_CATALOG.pro.monthlyPriceCents;
    const proYearlyCents = proPlan?.listYearlyCents ?? PLAN_CATALOG.pro.yearlyPriceCents ?? null;
    const zampellCents =
        billingPeriod === "year" && proYearlyCents != null && proYearlyCents > 0
            ? yearlyPerMonthCents(proYearlyCents)
            : proListCents;
    const maxYearlyPct = Math.max(0, ...plans.map((plan) => plan.yearlySavingsPercent));
    const yearlyHint = maxYearlyPct > 0 ? `economize até ${maxYearlyPct}%` : null;

    return (
        <>
            <ChannelSavings
                zampellMonthlyCents={zampellCents}
                billingPeriod={billingPeriod}
                onBillingPeriodChange={setBillingPeriod}
                yearlyHint={yearlyHint}
            />
            {children}
            <section id="planos" aria-labelledby="planos-titulo" className="scroll-mt-24 bg-slate-50">
                <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                    <h2
                        id="planos-titulo"
                        className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                    >
                        Planos
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
                        Preço de lista. A conta da seção anterior usa o Pro no período que você escolher. No
                        anual, o valor por mês cai.
                    </p>
                    <div className="mt-6 grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm sm:grid-cols-[minmax(0,18rem)_1fr]">
                        <img
                            src="/brand/panfleto-pedido.jpg"
                            alt="Adesivo no pedido com o WhatsApp e o cardápio web da loja."
                            width={1024}
                            height={1024}
                            className="aspect-square h-auto w-full object-cover sm:max-h-80"
                        />
                        <div className="flex flex-col justify-center px-5 py-5 sm:px-6">
                            <p className="text-xs font-extrabold tracking-wide text-emerald-700">
                                PRO E MARKET ANUAL
                            </p>
                            <p className="mt-2 text-base font-semibold leading-relaxed text-slate-950">
                                {ANNUAL_LEAFLETS}
                            </p>
                        </div>
                    </div>
                    <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                        {PLAN_GUARANTEE}
                    </p>
                    <div className="mt-6 grid gap-4 lg:grid-cols-3">
                        {plans.map((plan) => {
                            const showYear =
                                billingPeriod === "year" &&
                                plan.listYearlyCents != null &&
                                plan.listYearlyCents > 0;
                            const hasPromo =
                                plan.promoLabel != null && plan.offerMonthlyCents < plan.listMonthlyCents;
                            const priceCents = showYear
                                ? yearlyPerMonthCents(plan.listYearlyCents!)
                                : plan.offerMonthlyCents;
                            const showLeaflets = includesAnnualLeaflets(plan.key) && showYear;
                            return (
                                <article
                                    key={plan.key}
                                    className={cn(
                                        "relative flex flex-col overflow-hidden rounded-2xl border p-5 transition-all duration-200",
                                        plan.popular
                                            ? "border-slate-800 bg-slate-900 text-white shadow-2xl lg:z-10 lg:scale-[1.02]"
                                            : "border-slate-200/80 bg-white text-slate-950 shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                                    )}
                                >
                                    {plan.popular ? (
                                        <div
                                            aria-hidden
                                            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/25 to-transparent"
                                        />
                                    ) : null}
                                    {plan.popular ? (
                                        <p className="absolute top-4 right-4 rounded-full bg-emerald-500 px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-slate-950">
                                            MAIS POPULAR
                                        </p>
                                    ) : null}
                                    <h3
                                        className={cn(
                                            "relative font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight",
                                            plan.popular && "pr-28"
                                        )}
                                    >
                                        {plan.name}
                                    </h3>
                                    {plan.popular ? (
                                        <div className="relative mt-4">
                                            <BillingPeriodToggle
                                                appearance="onDark"
                                                id="billing-period-pro"
                                                value={billingPeriod}
                                                onValueChange={setBillingPeriod}
                                                yearlyHint={yearlyHint}
                                            />
                                        </div>
                                    ) : null}
                                    <p
                                        className={cn(
                                            "relative mt-2 min-h-12 text-sm leading-relaxed",
                                            plan.popular ? "text-slate-300" : "text-slate-600"
                                        )}
                                    >
                                        {PLAN_CARD_PITCH[plan.key]}
                                    </p>
                                    <p className="relative mt-4">
                                        {showYear ? (
                                            <span
                                                className={cn(
                                                    "mb-1 block text-sm line-through tabular-nums",
                                                    plan.popular ? "text-slate-400" : "text-slate-400"
                                                )}
                                            >
                                                De {formatBrlFromCents(plan.listMonthlyCents)}/mês
                                            </span>
                                        ) : null}
                                        {!showYear && hasPromo ? (
                                            <span className="mb-1 block text-sm text-slate-400 line-through tabular-nums">
                                                De {formatBrlFromCents(plan.listMonthlyCents)}
                                            </span>
                                        ) : null}
                                        <span className="text-3xl font-extrabold tabular-nums">
                                            {formatBrlFromCents(priceCents)}
                                        </span>
                                        <span
                                            className={cn(
                                                "text-sm font-semibold",
                                                plan.popular ? "text-slate-300" : "text-slate-500"
                                            )}
                                        >
                                            /mês
                                        </span>
                                    </p>
                                    {showYear && plan.listYearlyCents ? (
                                        <p
                                            className={cn(
                                                "relative mt-1 text-sm font-semibold tabular-nums",
                                                plan.popular ? "text-emerald-300" : "text-emerald-700"
                                            )}
                                        >
                                            {formatBrlFromCents(plan.listYearlyCents)}/ano à vista
                                            {plan.yearlySavingsPercent > 0
                                                ? ` · economize ${plan.yearlySavingsPercent}%`
                                                : ""}
                                        </p>
                                    ) : null}
                                    {showLeaflets ? (
                                        <p
                                            className={cn(
                                                "relative mt-3 rounded-xl px-3 py-2 text-sm font-semibold leading-relaxed",
                                                plan.popular
                                                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                                                    : "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                            )}
                                        >
                                            {ANNUAL_LEAFLETS}
                                        </p>
                                    ) : null}
                                    {!showYear && hasPromo && plan.promoLabel ? (
                                        <p className="relative mt-1 text-sm font-semibold text-emerald-600">
                                            {plan.promoLabel}
                                        </p>
                                    ) : null}
                                    <StartPolicyLine
                                        className={cn(
                                            "relative mt-2 text-xs",
                                            plan.popular ? "text-slate-400" : "text-slate-500"
                                        )}
                                    />
                                    <ul className="mt-4 flex-1 space-y-2">
                                        {PLAN_FEATURE_BLURBS[plan.key].map((feature, index) => {
                                            if (feature.kind === "plus") {
                                                return (
                                                    <li
                                                        key={`plus-${index}`}
                                                        aria-hidden
                                                        className={cn(
                                                            "text-lg font-bold",
                                                            plan.popular ? "text-emerald-400" : "text-emerald-600"
                                                        )}
                                                    >
                                                        +
                                                    </li>
                                                );
                                            }
                                            return (
                                                <li
                                                    key={feature.label}
                                                    className={cn(
                                                        "flex items-start gap-2 text-sm",
                                                        plan.popular ? "text-slate-200" : "text-slate-700"
                                                    )}
                                                >
                                                    {feature.ai ? (
                                                        <Sparkles
                                                            className={cn(
                                                                "mt-0.5 size-4 shrink-0",
                                                                plan.popular
                                                                    ? "text-emerald-300"
                                                                    : "text-emerald-600"
                                                            )}
                                                            aria-hidden
                                                        />
                                                    ) : (
                                                        <Check
                                                            className={cn(
                                                                "mt-0.5 size-4 shrink-0",
                                                                plan.popular
                                                                    ? "text-emerald-400"
                                                                    : "text-emerald-600"
                                                            )}
                                                            aria-hidden
                                                        />
                                                    )}
                                                    <span>{feature.label}</span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <a
                                        href={accountHref(
                                            `/signup?plano=${plan.key}&periodo=${billingPeriod}`,
                                            linkToApp
                                        )}
                                        className={cn(
                                            "relative mt-5 inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                                            plan.popular
                                                ? "bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20 hover:bg-emerald-400"
                                                : "bg-slate-950 text-white hover:bg-slate-800"
                                        )}
                                    >
                                        Quero este plano
                                    </a>
                                    <p
                                        className={cn(
                                            "relative mt-2 text-center text-[0.7rem] leading-snug",
                                            plan.popular ? "text-slate-400" : "text-slate-500"
                                        )}
                                    >
                                        {PLAN_GUARANTEE}
                                    </p>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>
        </>
    );
}
