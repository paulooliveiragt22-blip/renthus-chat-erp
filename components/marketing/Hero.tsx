"use client";

import { Check } from "lucide-react";
import { HERO, HERO_RISK } from "@/lib/marketing/copy";
import { LiveFlowSimulator } from "@/components/marketing/LiveFlowSimulator";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

const PROOF = [
    "Você opera pelo celular ou pelo computador.",
    "O cliente pede no WhatsApp ou no cardápio. Sem aplicativo para baixar.",
    "O canal é da loja. Sem comissão por venda.",
] as const;

export function Hero() {
    return (
        <section className="relative mx-auto max-w-6xl overflow-hidden px-4 py-20 sm:px-6 lg:py-24">
            <div className="max-w-3xl">
                <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
                    Zampell Delivery
                </p>
                <h1 className="mt-3 font-[family-name:var(--font-landing-display)] text-3xl font-extrabold tracking-tight text-balance text-slate-950 sm:text-5xl sm:leading-[1.08]">
                    {HERO.title}
                </h1>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
                    {HERO.subtitle}
                </p>
                <ul className="mt-6 space-y-3">
                    {PROOF.map((line) => (
                        <li key={line} className="flex items-start gap-3 text-slate-700">
                            <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Dialog>
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500"
                            >
                                Testar agente no WhatsApp
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[min(90vh,52rem)] max-w-5xl overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Teste o agente no WhatsApp</DialogTitle>
                                <DialogDescription>
                                    Bebida, áudio de churrasco ou lanche. O agente monta o pedido e o painel recebe a comanda.
                                </DialogDescription>
                            </DialogHeader>
                            <LiveFlowSimulator />
                            <DialogClose asChild>
                                <a
                                    href="#planos"
                                    className="inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-800"
                                >
                                    Ver planos e economizar
                                </a>
                            </DialogClose>
                        </DialogContent>
                    </Dialog>
                    <a
                        href="#planos"
                        className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white px-5 py-3 text-center text-base font-semibold text-slate-950 shadow-sm transition-all duration-200 hover:bg-slate-50"
                    >
                        Ver planos e economizar
                    </a>
                </div>
                <p className="mt-4 text-sm text-slate-600">{HERO_RISK}</p>
            </div>

            <div className="relative mt-12">
                <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(circle_at_center,rgba(5,150,105,0.18),transparent_68%)]"
                />
                <LiveFlowSimulator />
            </div>
        </section>
    );
}
