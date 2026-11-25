import { SavingsCalculator } from "@/components/marketing/SavingsCalculator";
import type { BillingPeriodValue } from "@/components/billing/BillingPeriodToggle";

type ChannelSavingsProps = {
    zampellMonthlyCents: number;
    billingPeriod: BillingPeriodValue;
    onBillingPeriodChange: (next: BillingPeriodValue) => void;
    yearlyHint?: string | null;
};

export function ChannelSavings({
    zampellMonthlyCents,
    billingPeriod,
    onBillingPeriodChange,
    yearlyHint,
}: ChannelSavingsProps) {
    return (
        <section id="economia" aria-labelledby="economia-titulo" className="scroll-mt-24 bg-slate-50 text-slate-950">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                <h2
                    id="economia-titulo"
                    className="max-w-2xl font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-balance text-slate-950 sm:text-3xl"
                >
                    No app, comissão em cada pedido. No seu WhatsApp, custo zero.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-snug text-slate-600 sm:text-base">
                    Arraste o volume e compare. Zampell não cobra percentual sobre a venda.
                </p>

                <SavingsCalculator
                    zampellMonthlyCents={zampellMonthlyCents}
                    billingPeriod={billingPeriod}
                    onBillingPeriodChange={onBillingPeriodChange}
                    yearlyHint={yearlyHint}
                />
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <a
                        href="#planos"
                        className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500"
                    >
                        Escolher plano
                    </a>
                    <p className="text-sm text-slate-600">
                        Anual Pro/Market: 1.000 panfletos pra trazer o cliente do app pro Zap.
                    </p>
                </div>
            </div>
        </section>
    );
}
