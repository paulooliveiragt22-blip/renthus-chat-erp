import { Check } from "lucide-react";
import { StartPolicyLine } from "@/components/marketing/StartPolicyLine";
import { HERO } from "@/lib/marketing/copy";

const PROOF = [
    "Você opera pelo celular ou pelo computador.",
    "O cliente pede no WhatsApp ou no cardápio. Sem aplicativo para baixar.",
    "O canal é da loja. Sem comissão por venda.",
] as const;

export function Hero() {
    return (
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-20">
            <div>
                <p className="text-sm font-semibold tracking-wide text-[#1a8f4a] uppercase">
                    Zampell Delivery
                </p>
                <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[#16364D] text-balance sm:text-5xl sm:leading-[1.08]">
                    {HERO.title}
                </h1>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#16364D]/80">
                    {HERO.subtitle}
                </p>
                <ul className="mt-6 space-y-3">
                    {PROOF.map((line) => (
                        <li key={line} className="flex items-start gap-3 text-[#16364D]">
                            <Check className="mt-0.5 size-5 shrink-0 text-[#1a8f4a]" aria-hidden />
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <a
                        href="#planos"
                        className="inline-flex items-center justify-center rounded-full bg-[#1a8f4a] px-5 py-3 text-base font-bold text-white hover:brightness-95"
                    >
                        Escolher plano
                    </a>
                    <a
                        href="#economia"
                        className="inline-flex items-center justify-center rounded-full border border-[#16364D]/15 bg-white px-5 py-3 text-base font-bold text-[#16364D] hover:bg-zinc-50"
                    >
                        Ver a conta contra os apps
                    </a>
                </div>
                <StartPolicyLine className="mt-4 text-sm text-[#16364D]/70" />
            </div>

            <div
                className="rounded-3xl border border-[#16364D]/10 bg-white p-4 shadow-[0_20px_50px_rgba(22,54,77,0.08)] sm:p-6"
            >
                <p className="text-xs font-bold tracking-wide text-[#16364D]/50 uppercase">
                    WhatsApp da loja
                </p>
                <div className="mt-4 space-y-3">
                    <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#dcf8c6] px-3 py-2 text-sm text-[#16364D]">
                        Manda 2 caixas da lager 350 ml e 1 unidade do energético.
                    </p>
                    <p className="max-w-[90%] rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-sm text-[#16364D]">
                        Fechei 2 CX de lager 350 ml e 1 UN de energético. Entrega no centro, PIX.
                        Confirma?
                    </p>
                </div>
                <div className="mt-4 rounded-2xl border border-[#1a8f4a]/20 bg-[#f3fbf6] p-3">
                    <p className="text-xs font-bold text-[#1a8f4a]">Pedido no painel</p>
                    <p className="mt-1 text-sm font-semibold text-[#16364D]">
                        Comanda na impressora · estoque baixou · valor no caixa
                    </p>
                </div>
            </div>
        </section>
    );
}
