import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { accountHref } from "@/lib/marketing/hosts";
import { Faq } from "@/components/marketing/Faq";
import { Hero } from "@/components/marketing/Hero";
import { LandingReveal } from "@/components/marketing/LandingReveal";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PainStrip } from "@/components/marketing/PainStrip";
import { PlanShowcase } from "@/components/marketing/PlanShowcase";
import { ProductLoop } from "@/components/marketing/ProductLoop";

const inter = Inter({ subsets: ["latin"], variable: "--font-landing-body" });
const jakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-landing-display",
});

type MarketingHomeProps = {
    linkToApp?: boolean;
};

export function MarketingHome({ linkToApp = false }: MarketingHomeProps) {
    return (
        <div
            className={`${inter.variable} ${jakarta.variable} min-h-screen scroll-smooth bg-white font-[family-name:var(--font-landing-body)] text-slate-950`}
        >
            <MarketingHeader linkToApp={linkToApp} />
            <main>
                <Hero />
                <LandingReveal>
                    <PainStrip />
                </LandingReveal>
                <LandingReveal>
                    <ProductLoop />
                </LandingReveal>
                <LandingReveal>
                    <PlanShowcase linkToApp={linkToApp} />
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
                            O pedido de quem já te conhece não precisa passar pelo aplicativo.
                        </h2>
                        <p className="mt-3 text-base text-slate-300">
                            Escolhe o plano, ativa o agente e publica o cardápio.
                        </p>
                        <a
                            href="#planos"
                            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-3 text-base font-semibold text-slate-950 shadow-sm shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400"
                        >
                            Começar com Zampell Delivery
                        </a>
                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200/80 bg-white px-4 py-8 text-center text-sm text-slate-600">
                <p>
                    Já tem conta?{" "}
                    <a href={accountHref("/login", linkToApp)} className="font-bold text-slate-950 underline-offset-2 hover:underline">
                        Entrar
                    </a>
                </p>
                <p className="mt-3">© {new Date().getFullYear()} Zampell · Todos os direitos reservados</p>
            </footer>
        </div>
    );
}
