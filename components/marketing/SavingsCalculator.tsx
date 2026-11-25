"use client";

import { useState } from "react";
import { BillingPeriodToggle, type BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";
import {
    SAVINGS_SLIDER_MAX_CENTS,
    SAVINGS_SLIDER_MIN_CENTS,
    SAVINGS_SLIDER_STEP_CENTS,
    formatBrlFromCents,
    savingsAtVolume,
} from "@/lib/marketing/marketplaceFees";

type SavingsCalculatorProps = {
    zampellMonthlyCents: number;
    billingPeriod: BillingPeriodValue;
    onBillingPeriodChange: (next: BillingPeriodValue) => void;
    yearlyHint?: string | null;
};

export function SavingsCalculator({
    zampellMonthlyCents,
    billingPeriod,
    onBillingPeriodChange,
    yearlyHint,
}: SavingsCalculatorProps) {
    const [volumeCents, setVolumeCents] = useState(1_000_000);
    const example = savingsAtVolume(volumeCents, zampellMonthlyCents);
    const ifood = example.keptVersus.find((row) => row.id === "ifood");
    const keptMonth = ifood?.keptCents ?? 0;
    const periodLabel = billingPeriod === "year" ? "Pro anual" : "Pro mensal";

    return (
        <div>
            <div className="mt-8 max-w-xl rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <label htmlFor="vendas-apps" className="block text-sm font-semibold text-slate-700">
                    Quanto você vende por mês nos aplicativos?
                </label>
                <p className="mt-2 font-[family-name:var(--font-landing-display)] text-4xl font-extrabold tracking-tight text-slate-950 tabular-nums">
                    {formatBrlFromCents(volumeCents)}
                </p>
                <input
                    id="vendas-apps"
                    type="range"
                    min={SAVINGS_SLIDER_MIN_CENTS}
                    max={SAVINGS_SLIDER_MAX_CENTS}
                    step={SAVINGS_SLIDER_STEP_CENTS}
                    value={volumeCents}
                    onChange={(event) => setVolumeCents(Number(event.target.value))}
                    aria-valuemin={SAVINGS_SLIDER_MIN_CENTS / 100}
                    aria-valuemax={SAVINGS_SLIDER_MAX_CENTS / 100}
                    aria-valuenow={volumeCents / 100}
                    aria-valuetext={formatBrlFromCents(volumeCents)}
                    className="mt-4 h-3 w-full cursor-pointer accent-emerald-600"
                />
                <div className="mt-2 flex justify-between text-xs text-slate-500 tabular-nums">
                    <span>{formatBrlFromCents(SAVINGS_SLIDER_MIN_CENTS)}</span>
                    <span>{formatBrlFromCents(SAVINGS_SLIDER_MAX_CENTS)}</span>
                </div>
            </div>

            <div className="mt-6">
                <BillingPeriodToggle
                    appearance="light"
                    id="billing-period-economia"
                    value={billingPeriod}
                    onValueChange={onBillingPeriodChange}
                    yearlyHint={yearlyHint}
                    className="max-w-full flex-wrap"
                />
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <table className="w-full table-fixed border-collapse text-left text-xs sm:text-sm">
                    <caption className="sr-only">
                        Custo de referência dos apps contra a mensalidade do {periodLabel} neste volume
                    </caption>
                    <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                        <tr>
                            <th scope="col" className="px-4 py-3 font-semibold">Canal</th>
                            <th scope="col" className="px-4 py-3 font-semibold">O que sai</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Neste volume</th>
                        </tr>
                    </thead>
                    <tbody>
                        {example.rows.map((row) => (
                            <tr key={row.id} className="border-t border-slate-200/80">
                                <th scope="row" className="px-4 py-3 font-semibold text-slate-950">
                                    {row.name}
                                </th>
                                <td className="px-4 py-3 text-slate-600">{row.takeLabel}</td>
                                <td className="px-4 py-3 font-bold text-slate-950 tabular-nums">
                                    {formatBrlFromCents(row.costCents)}
                                </td>
                            </tr>
                        ))}
                        <tr className="border-t-2 border-emerald-600 bg-emerald-50">
                            <th scope="row" className="px-4 py-3 font-semibold text-emerald-800">
                                <span className="flex flex-wrap items-center gap-2">
                                    Zampell · {periodLabel}
                                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[0.65rem] font-extrabold tracking-wide text-white uppercase">
                                        Melhor escolha
                                    </span>
                                </span>
                            </th>
                            <td className="px-4 py-3 text-emerald-800">Mensalidade fixa, sem % por pedido</td>
                            <td className="px-4 py-3 font-extrabold text-emerald-700 tabular-nums">
                                {formatBrlFromCents(example.zampellCents)}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {keptMonth > 0 ? (
                <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-lg font-extrabold text-emerald-800 tabular-nums">
                    Com a Zampell, ficam {formatBrlFromCents(keptMonth)} a mais no seu caixa todo mês (
                    {formatBrlFromCents(keptMonth * 12)} no ano)
                </p>
            ) : null}

        </div>
    );
}
