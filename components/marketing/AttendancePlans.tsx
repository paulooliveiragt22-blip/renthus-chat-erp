"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { BillingPeriodToggle, type BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";
import {
    ATTENDANCE_FEATURES,
    ATTENDANCE_MONTHLY_CENTS,
    ATTENDANCE_YEARLY_CENTS,
    ATTENDANCE_YEARLY_PER_MONTH_CENTS,
    attendanceTalkHref,
    attendanceYearlySavingsPercent,
} from "@/lib/marketing/attendanceOffer";
import { formatBrlFromCents } from "@/lib/marketing/marketplaceFees";
import { cn } from "@/lib/utils";

export function AttendancePlans() {
    const [billingPeriod, setBillingPeriod] = useState<BillingPeriodValue>("year");
    const showYear = billingPeriod === "year";
    const priceCents = showYear ? ATTENDANCE_YEARLY_PER_MONTH_CENTS : ATTENDANCE_MONTHLY_CENTS;
    const savings = attendanceYearlySavingsPercent();
    const yearlyHint = savings > 0 ? `economize ${savings}%` : null;

    return (
        <section id="planos" aria-labelledby="planos-titulo" className="scroll-mt-24 bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                <h2
                    id="planos-titulo"
                    className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                >
                    Planos
                </h2>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <article className="relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 text-white shadow-2xl transition duration-200 ease-out hover:-translate-y-1 hover:shadow-emerald-900/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/25 to-transparent"
                        />
                        <p className="absolute top-4 right-4 rounded-full bg-emerald-500 px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-slate-950">
                            COMECE AQUI
                        </p>
                        <h3 className="relative pr-28 font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight">
                            Office
                        </h3>
                        <div className="relative mt-4">
                            <BillingPeriodToggle
                                appearance="onDark"
                                id="billing-period-atendimento"
                                value={billingPeriod}
                                onValueChange={setBillingPeriod}
                                yearlyHint={yearlyHint}
                                className="max-w-full flex-wrap"
                            />
                        </div>
                        <p className="relative mt-2 min-h-12 text-sm leading-relaxed text-slate-300">
                            Pra quem atende no WhatsApp e precisa de agenda e card do serviço.
                        </p>
                        <p className="relative mt-4">
                            {showYear ? (
                                <span className="mb-1 block text-sm text-slate-400 line-through tabular-nums">
                                    De {formatBrlFromCents(ATTENDANCE_MONTHLY_CENTS)}/mês
                                </span>
                            ) : null}
                            <span className="text-3xl font-extrabold tabular-nums">
                                {formatBrlFromCents(priceCents)}
                            </span>
                            <span className="text-sm font-semibold text-slate-300">/mês</span>
                        </p>
                        {showYear ? (
                            <p className="relative mt-1 text-sm font-semibold text-emerald-300 tabular-nums">
                                {formatBrlFromCents(ATTENDANCE_YEARLY_CENTS)}/ano à vista
                                {savings > 0 ? ` · economize ${savings}%` : ""}
                            </p>
                        ) : null}
                        <ul className="mt-4 flex-1 space-y-2">
                            {ATTENDANCE_FEATURES.map((feature) => (
                                <li key={feature.label} className="flex items-start gap-2 text-sm text-slate-200">
                                    {feature.ai ? (
                                        <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
                                    ) : (
                                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                                    )}
                                    <span>{feature.label}</span>
                                </li>
                            ))}
                        </ul>
                        <a
                            href={attendanceTalkHref(showYear ? "year" : "month")}
                            className="relative mt-5 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400"
                        >
                            {showYear ? "Quero o anual" : "Quero o mensal"}
                        </a>
                    </article>
                    <article className="relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 text-slate-950 shadow-sm transition duration-200 ease-out hover:-translate-y-1 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                        <h3 className="font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight">
                            Enterprise
                        </h3>
                        <p className="mt-2 min-h-12 text-sm leading-relaxed text-slate-600">
                            Pra operação que não cabe no plano de tabela. A gente monta o plano com a empresa.
                        </p>
                        <p className="mt-4">
                            <span className="text-3xl font-extrabold">Sob consulta</span>
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">Sem preço nesta página</p>
                        <ul className="mt-4 flex-1 space-y-2">
                            <li className="flex items-start gap-2 text-sm text-slate-700">
                                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                                <span>Conversa para entender a operação</span>
                            </li>
                            <li className="flex items-start gap-2 text-sm text-slate-700">
                                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                                <span>Plano montado para a empresa</span>
                            </li>
                        </ul>
                        <a
                            href={attendanceTalkHref("enterprise")}
                            className={cn(
                                "mt-5 inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-800"
                            )}
                        >
                            Falar com a gente
                        </a>
                    </article>
                </div>
            </div>
        </section>
    );
}
