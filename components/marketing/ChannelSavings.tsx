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
                    className="max-w-3xl font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-balance text-slate-950 sm:text-3xl"
                >
                    No app, a comissão sai de cada pedido. No seu canal, a mensalidade é fixa.
                </h2>
                <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
                    Entrega feita pela loja e pagamento dentro do aplicativo. A Zampell entra com a
                    mensalidade do Pro, sem percentual sobre a venda. Arraste o volume para ver a diferença.
                </p>

                <SavingsCalculator
                    zampellMonthlyCents={zampellMonthlyCents}
                    billingPeriod={billingPeriod}
                    onBillingPeriodChange={onBillingPeriodChange}
                    yearlyHint={yearlyHint}
                />
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-500">
                    Se o aplicativo também manda o motoboy, a referência muda: iFood Plano Entrega 23% + 3,2%,
                    Aiqfome 19,99%, 99Food 8,9% mais custo por km. O motoboy da loja continua no canal próprio.
                    PIX e cartão na sua maquininha têm a taxa da operadora. No anual, o Pro sai menos por mês
                    e a diferença aumenta.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <a
                        href="#planos"
                        className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500"
                    >
                        Escolher plano
                    </a>
                    <p className="text-sm text-slate-600">
                        Pro e Market no anual incluem 1.000 panfletos pra trazer o cliente do app pro seu Zap.
                    </p>
                </div>
            </div>
        </section>
    );
}
