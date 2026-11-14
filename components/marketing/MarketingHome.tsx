import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { PLAN_GUARANTEE } from "@/lib/marketing/copy";
import { accountHref } from "@/lib/marketing/hosts";
import { Faq } from "@/components/marketing/Faq";
import { Hero } from "@/components/marketing/Hero";
import { LandingReveal } from "@/components/marketing/LandingReveal";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PlanShowcase } from "@/components/marketing/PlanShowcase";
import { ProductLoop } from "@/components/marketing/ProductLoop";
import { StickySignupCta } from "@/components/marketing/StickySignupCta";

const inter = Inter({ subsets: ["latin"], variable: "--font-landing-body" });
const jakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-landing-display",
});

type MarketingHomeProps = {
    linkToApp?: boolean;
};

export function MarketingHome({ linkToApp = false }: MarketingHomeProps) {
    const proSignupHref = accountHref("/signup?plano=pro&periodo=year", linkToApp);

    return (
        <div
            className={`${inter.variable} ${jakarta.variable} min-h-screen scroll-smooth bg-white pb-28 font-[family-name:var(--font-landing-body)] text-slate-950 lg:pb-0`}
        >
            <MarketingHeader linkToApp={linkToApp} />
            <main>
                <Hero />
                <LandingReveal>
                    <PlanShowcase linkToApp={linkToApp}>
                        <LandingReveal>
                            <ProductLoop />
                        </LandingReveal>
                    </PlanShowcase>
                </LandingReveal>
                <LandingReveal>
                    <Faq />
                </LandingReveal>
                <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:py-24">
                    <div
                        aria-labelledby="cta-final"
                        className="mx-auto max-w-3xl rounded-3xl bg-slate-950 px-6 py-12 text-center text-white shadow-2xl sm:px-10"
                    >
                        <h2
                            id="cta-final"
                            className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-balance sm:text-3xl"
                        >
                            Tire a comissão do pedido de quem já te conhece.
                        </h2>
                        <p className="mt-3 text-base text-slate-300">
                            Ativa o Pro anual, conecta o WhatsApp e publica o cardápio. Em 15 minutos a loja
                            começa a receber pedido no próprio canal.
                        </p>
                        <a
                            href={proSignupHref}
                            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-3 text-base font-semibold text-slate-950 shadow-sm shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400"
                        >
                            Começar no Pro anual
                        </a>
                        <p className="mt-3 text-sm text-slate-400">{PLAN_GUARANTEE}</p>
                        <a
                            href="#planos"
                            className="mt-4 inline-block text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
                        >
                            Comparar os três planos
                        </a>
                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200/80 bg-white px-4 py-8 text-center text-sm text-slate-600">
                <p>
                    Já tem conta?{" "}
                    <a
                        href={accountHref("/login", linkToApp)}
                        className="font-bold text-slate-950 underline-offset-2 hover:underline"
                    >
                        Entrar
                    </a>
                </p>
                <p className="mt-3">© {new Date().getFullYear()} Zampell · Todos os direitos reservados</p>
            </footer>
            <StickySignupCta linkToApp={linkToApp} />
        </div>
    );
}
