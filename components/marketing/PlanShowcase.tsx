"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { BillingPeriodToggle, type BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";
import { PLAN_CATALOG, PLAN_ORDER, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { yearlySavingsPercent } from "@/lib/billing/yearlyFromDiscount";
import { PLAN_CARD_PITCH, PLAN_FEATURE_BLURBS } from "@/lib/marketing/copy";
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

type PlanShowcaseProps = {
    linkToApp?: boolean;
};

export function PlanShowcase({ linkToApp = false }: PlanShowcaseProps) {
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

    const proListCents =
        plans.find((plan) => plan.key === "pro")?.listMonthlyCents ??
        PLAN_CATALOG.pro.monthlyPriceCents;
    const maxYearlyPct = Math.max(0, ...plans.map((plan) => plan.yearlySavingsPercent));

    return (
        <>
            <ChannelSavings zampellMonthlyCents={proListCents} />
            <section id="planos" aria-labelledby="planos-titulo" className="scroll-mt-24 mx-auto max-w-6xl px-4 py-16 sm:px-6">
                <h2 id="planos-titulo" className="text-2xl font-extrabold tracking-tight text-[#16364D] sm:text-3xl">
                    Planos
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#16364D]/75">
                    Preço de lista. A conta da seção anterior usa o Pro mensal. No anual, o valor por mês cai.
                </p>
                <div className="mt-6">
                    <BillingPeriodToggle
                        appearance="light"
                        value={billingPeriod}
                        onValueChange={setBillingPeriod}
                        yearlyHint={maxYearlyPct > 0 ? `economize até ${maxYearlyPct}%` : null}
                    />
                </div>
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
                        return (
                            <article
                                key={plan.key}
                                className={cn(
                                    "relative flex flex-col rounded-2xl border bg-white p-5",
                                    plan.popular
                                        ? "border-[#1a8f4a] shadow-[0_12px_32px_rgba(26,143,74,0.16)]"
                                        : "border-[#16364D]/10"
                                )}
                            >
                                {plan.popular ? (
                                    <p className="absolute -top-3 left-5 rounded-full bg-[#1a8f4a] px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-white">
                                        MAIS POPULAR
                                    </p>
                                ) : null}
                                <h3 className="text-lg font-extrabold text-[#16364D]">{plan.name}</h3>
                                <p className="mt-2 min-h-12 text-sm leading-relaxed text-[#16364D]/75">
                                    {PLAN_CARD_PITCH[plan.key]}
                                </p>
                                <p className="mt-4 text-[#16364D]">
                                    {showYear ? (
                                        <span className="mb-1 block text-sm text-[#16364D]/50 line-through">
                                            De {formatBrlFromCents(plan.listMonthlyCents)}/mês
                                        </span>
                                    ) : null}
                                    {!showYear && hasPromo ? (
                                        <span className="mb-1 block text-sm text-[#16364D]/50 line-through">
                                            De {formatBrlFromCents(plan.listMonthlyCents)}
                                        </span>
                                    ) : null}
                                    <span className="text-3xl font-extrabold tabular-nums">
                                        {formatBrlFromCents(priceCents)}
                                    </span>
                                    <span className="text-sm font-semibold text-[#16364D]/60">/mês</span>
                                </p>
                                {showYear && plan.listYearlyCents ? (
                                    <p className="mt-1 text-sm font-semibold text-[#1a8f4a]">
                                        {formatBrlFromCents(plan.listYearlyCents)}/ano à vista
                                        {plan.yearlySavingsPercent > 0
                                            ? ` · economize ${plan.yearlySavingsPercent}%`
                                            : ""}
                                    </p>
                                ) : null}
                                {!showYear && hasPromo && plan.promoLabel ? (
                                    <p className="mt-1 text-sm font-semibold text-[#1a8f4a]">{plan.promoLabel}</p>
                                ) : null}
                                <StartPolicyLine className="mt-2 text-xs text-[#16364D]/60" />
                                <ul className="mt-4 flex-1 space-y-2">
                                    {PLAN_FEATURE_BLURBS[plan.key].map((feature, index) => {
                                        if (feature.kind === "plus") {
                                            return (
                                                <li key={`plus-${index}`} aria-hidden className="text-lg font-bold text-[#1a8f4a]">
                                                    +
                                                </li>
                                            );
                                        }
                                        return (
                                            <li key={feature.label} className="flex items-start gap-2 text-sm text-[#16364D]">
                                                {feature.ai ? (
                                                    <Sparkles className="mt-0.5 size-4 shrink-0 text-[#7C3AED]" aria-hidden />
                                                ) : (
                                                    <Check className="mt-0.5 size-4 shrink-0 text-[#1a8f4a]" aria-hidden />
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
                                        "mt-5 inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-bold",
                                        plan.popular
                                            ? "bg-[#1a8f4a] text-white"
                                            : "bg-[#16364D] text-white"
                                    )}
                                >
                                    Quero este plano
                                </a>
                            </article>
                        );
                    })}
                </div>
            </section>
        </>
    );
}
