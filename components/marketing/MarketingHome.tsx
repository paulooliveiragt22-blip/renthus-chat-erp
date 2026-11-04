import { accountHref } from "@/lib/marketing/hosts";
import { Faq } from "@/components/marketing/Faq";
import { Hero } from "@/components/marketing/Hero";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PainStrip } from "@/components/marketing/PainStrip";
import { PlanShowcase } from "@/components/marketing/PlanShowcase";
import { ProductLoop } from "@/components/marketing/ProductLoop";

type MarketingHomeProps = {
    linkToApp?: boolean;
};

export function MarketingHome({ linkToApp = false }: MarketingHomeProps) {
    return (
        <div className="min-h-screen bg-[#f3f4f6] text-[#16364D]">
            <MarketingHeader linkToApp={linkToApp} />
            <main>
                <Hero />
                <PainStrip />
                <ProductLoop />
                <PlanShowcase linkToApp={linkToApp} />
                <Faq />
                <section aria-labelledby="cta-final" className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
                    <h2 id="cta-final" className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
                        O pedido de quem já te conhece não precisa passar pelo aplicativo.
                    </h2>
                    <p className="mt-3 text-base text-[#16364D]/75">
                        Escolhe o plano, ativa o agente e publica o cardápio.
                    </p>
                    <a
                        href="#planos"
                        className="mt-6 inline-flex items-center justify-center rounded-full bg-[#1a8f4a] px-5 py-3 text-base font-bold text-white"
                    >
                        Começar com Zampell Delivery
                    </a>
                </section>
            </main>
            <footer className="border-t border-[#16364D]/10 px-4 py-8 text-center text-sm text-[#16364D]/60">
                <p>
                    Já tem conta?{" "}
                    <a href={accountHref("/login", linkToApp)} className="font-bold text-[#16364D] underline-offset-2 hover:underline">
                        Entrar
                    </a>
                </p>
                <p className="mt-3">© {new Date().getFullYear()} Zampell · Todos os direitos reservados</p>
            </footer>
        </div>
    );
}
