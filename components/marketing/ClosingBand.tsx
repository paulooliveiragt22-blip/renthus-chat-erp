import { PLAN_GUARANTEE } from "@/lib/marketing/copy";
import { accountHref } from "@/lib/marketing/hosts";

type ClosingBandProps = {
    linkToApp?: boolean;
};

export function ClosingBand({ linkToApp = false }: ClosingBandProps) {
    const proSignupHref = accountHref("/signup?plano=pro&periodo=year", linkToApp);

    return (
        <section className="bg-slate-100 px-4 py-20 sm:px-6 lg:py-28">
            <div className="mx-auto max-w-3xl text-center">
                <h2 className="font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl">
                    Comece hoje.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
                    Ativa o Pro, conecta o WhatsApp e publica o cardápio. Em 15 minutos a loja recebe no canal próprio.
                </p>
                <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                    <a
                        href={proSignupHref}
                        className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500 sm:w-auto"
                    >
                        Começar no Pro anual
                    </a>
                    <a
                        href="#planos"
                        className="inline-flex w-full items-center justify-center rounded-full bg-emerald-50 px-5 py-3 text-base font-semibold text-emerald-800 transition-all duration-200 hover:bg-emerald-100 sm:w-auto"
                    >
                        Comparar os planos
                    </a>
                </div>
                <p className="mt-4 text-sm text-slate-500">{PLAN_GUARANTEE}</p>
            </div>
        </section>
    );
}
