import { LOYALTY } from "@/lib/marketing/copy";
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
                <h2 id="economia-titulo" className="max-w-3xl font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-balance text-slate-950 sm:text-3xl">
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

                <h3 className="mt-14 font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950">
                    Quem já comprou volta no seu WhatsApp e no seu cardápio
                </h3>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {LOYALTY.map((item) => (
                        <article key={item.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md">
                            <h4 className="text-base font-extrabold text-slate-950">{item.title}</h4>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
