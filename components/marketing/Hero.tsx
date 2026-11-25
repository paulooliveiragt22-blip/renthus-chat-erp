import { AGENT_DEMO_WHATSAPP_HREF, HERO, HERO_RISK } from "@/lib/marketing/copy";
import { accountHref } from "@/lib/marketing/hosts";
import { ProductStage } from "@/components/marketing/ProductStage";

type HeroProps = {
    linkToApp?: boolean;
};

export function Hero({ linkToApp = false }: HeroProps) {
    const proSignupHref = accountHref("/signup?plano=pro&periodo=year", linkToApp);

    return (
        <section className="relative overflow-hidden bg-white pt-16 pb-0 sm:pt-24">
            <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
                <h1 className="font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-6xl sm:leading-[1.05] lg:text-7xl">
                    <span className="block">{HERO.lead}</span>
                    <span className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                        {HERO.beforeAccent}{" "}
                        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 sm:px-4">
                            <span className="size-2.5 rounded-full bg-emerald-500 sm:size-3" aria-hidden />
                            <span>{HERO.accent}</span>
                        </span>
                    </span>
                </h1>
                <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                    {HERO.subtitle}
                </p>
                <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                    <a
                        href={proSignupHref}
                        className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500 sm:w-auto"
                    >
                        Começar no Pro anual
                    </a>
                    <a
                        href={AGENT_DEMO_WHATSAPP_HREF}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center rounded-full bg-emerald-50 px-5 py-3 text-base font-semibold text-emerald-800 transition-all duration-200 hover:bg-emerald-100 sm:w-auto"
                    >
                        Ver o agente
                    </a>
                </div>
                <p className="mt-4 text-sm text-slate-500">{HERO_RISK}</p>
            </div>
            <ProductStage />
        </section>
    );
}
