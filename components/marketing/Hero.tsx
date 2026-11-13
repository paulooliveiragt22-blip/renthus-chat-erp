"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { HERO, HERO_RISK } from "@/lib/marketing/copy";
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

const PANEL_BADGES = ["Comanda impressa", "−2 CX estoque", "+R$ 189,00 caixa"] as const;

function DemoThread() {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3 shadow-sm">
                <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">WhatsApp da loja</p>
                <div className="mt-3 space-y-3">
                    <p className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-emerald-100 px-3 py-2 text-sm text-slate-950">
                        Manda 2 caixas da lager 350 ml e 1 energético
                    </p>
                    <p className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[0.7rem] font-bold text-emerald-700">
                        IA respondendo em 3s
                    </p>
                    <p className="max-w-[95%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-slate-950 shadow-sm">
                        Fechei 2 CX de lager 350 ml e 1 UN de energético. Entrega no centro, PIX. Confirma?
                    </p>
                </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-white shadow-xl">
                <p className="text-xs font-bold tracking-wide text-emerald-300 uppercase">Pedido no painel</p>
                <p className="mt-2 text-sm font-semibold">Lager 350 ml · 2 CX + 1 UN</p>
                <ul className="mt-3 space-y-2">
                    {PANEL_BADGES.map((badge, index) => (
                        <motion.li
                            key={badge}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + index * 0.12, duration: 0.35 }}
                            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200"
                        >
                            ✓ {badge}
                        </motion.li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export function Hero() {
    return (
        <section className="relative mx-auto grid max-w-6xl items-center gap-10 overflow-hidden px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-24">
            <div>
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
                                className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-sm shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500"
                            >
                                Testar agente no WhatsApp
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>Teste o agente no WhatsApp</DialogTitle>
                                <DialogDescription>
                                    O cliente pede caixa e unidade. O agente confirma e o pedido cai no painel.
                                </DialogDescription>
                            </DialogHeader>
                            <DemoThread />
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

            <div className="relative">
                <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(circle_at_center,rgba(5,150,105,0.18),transparent_68%)]"
                />
                <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-xl sm:p-6">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                        Do Zap ao caixa
                    </p>
                    <p className="rounded-full bg-emerald-600 px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-white uppercase">
                        Demonstração real
                    </p>
                </div>
                <div className="mt-4">
                    <DemoThread />
                </div>
                </div>
            </div>
        </section>
    );
}
