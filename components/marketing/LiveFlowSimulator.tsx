"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Play, RotateCcw } from "lucide-react";

type CustomerKind = "text" | "audio";

type FlowScenario = {
    id: string;
    tab: string;
    customerKind: CustomerKind;
    customer: string;
    audioDuration: string | null;
    agent: string;
    orderLabel: string;
    badges: readonly string[];
};

const SCENARIOS: readonly FlowScenario[] = [
    {
        id: "bebidas",
        tab: "Bebidas (Caixa + UN)",
        customerKind: "text",
        audioDuration: null,
        customer:
            "Boa noite! Manda 2 caixas de Heineken long neck, 1 fardo de Coca 2L e 3 energéticos Red Bull. Entrega na Rua das Acácias, 420. Pago no PIX.",
        agent: "Pedido montado! 🍺\n• 2x CX Heineken LN (12un) — R$ 156,00\n• 1x FD Coca-Cola 2L (6un) — R$ 54,00\n• 3x UN Red Bull 250ml — R$ 27,00\n• Taxa de entrega: R$ 7,00\nTotal: R$ 244,00 (PIX). Confirma o envio?",
        orderLabel: "#1048 · Entrega motoboy",
        badges: [
            "Comanda impressa no balcão",
            "Estoque baixado (−2 CX, −1 FD, −3 UN)",
            "R$ 244,00 lançado no caixa (PIX)",
        ],
    },
    {
        id: "churrasco",
        tab: "Churrasco (Áudio no Zap)",
        customerKind: "audio",
        audioDuration: "0:08",
        customer:
            "Ôpa, vê pra mim 3 fardos de Brahma duplo malte latão, 2 sacos de gelo de coco e 1 carvão de 5kg. Vou pagar metade no PIX e metade no cartão na entrega.",
        agent: "Anotei tudo aqui! 🔥\n• 3x FD Brahma Duplo Malte 473ml — R$ 165,00\n• 2x UN Gelo de Coco 5kg — R$ 24,00\n• 1x UN Carvão Vegetal 5kg — R$ 22,00\n• Pagamento misto: PIX + Cartão na entrega\nTotal: R$ 211,00. Posso mandar separar?",
        orderLabel: "#1049 · Pagamento misto",
        badges: [
            "Comanda impressa no balcão",
            "Estoque baixado (−3 FD, −3 UN)",
            "R$ 211,00 lançado no financeiro",
        ],
    },
    {
        id: "lanches",
        tab: "Lanches e Porções",
        customerKind: "text",
        audioDuration: null,
        customer:
            "Quero 2 X-Bacon sem cebola, 1 porção de batata com cheddar e bacon e 1 Coca 2L. Retiro no balcão.",
        agent: "Fechado! 🍔\n• 2x X-Bacon (obs: sem cebola) — R$ 56,00\n• 1x Batata Cheddar & Bacon — R$ 34,00\n• 1x Coca-Cola 2L — R$ 14,00\n• Retirada no balcão (sem taxa)\nTotal: R$ 104,00. Como prefere pagar?",
        orderLabel: "#1050 · Retirada balcão",
        badges: [
            "Comanda enviada pra cozinha",
            "Observações destacadas",
            "R$ 104,00 lançado no caixa",
        ],
    },
];

export function LiveFlowSimulator() {
    const [index, setIndex] = useState(0);
    const [run, setRun] = useState(0);
    const scenario = SCENARIOS[index] ?? SCENARIOS[0];

    function selectScenario(next: number) {
        setIndex(next);
        setRun((current) => current + 1);
    }

    return (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-xl sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Do Zap ao caixa</p>
                <div role="tablist" aria-label="Cenários do agente" className="flex flex-wrap gap-2">
                    {SCENARIOS.map((item, itemIndex) => {
                        const selected = item.id === scenario.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                id={`fluxo-tab-${item.id}`}
                                aria-selected={selected}
                                aria-controls={`fluxo-painel-${item.id}`}
                                onClick={() => selectScenario(itemIndex)}
                                className={
                                    selected
                                        ? "rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200"
                                        : "rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-200 hover:bg-slate-50"
                                }
                            >
                                {item.tab}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div
                id={`fluxo-painel-${scenario.id}`}
                role="tabpanel"
                aria-labelledby={`fluxo-tab-${scenario.id}`}
                key={`${scenario.id}-${run}`}
                className="mt-5 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)]"
            >
                <ChatPane scenario={scenario} />
                <SpeedLink />
                <PanelPane scenario={scenario} />
            </div>

            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => setRun((current) => current + 1)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-50"
                >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Simular novamente
                </button>
            </div>
        </div>
    );
}

function ChatPane({ scenario }: { scenario: FlowScenario }) {
    return (
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">WhatsApp da loja</p>
                <p className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-emerald-700">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                    Agente Zampell · Online
                </p>
            </div>
            <div className="mt-3 space-y-3">
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                >
                    {scenario.customerKind === "audio" && scenario.audioDuration ? (
                        <AudioBubble duration={scenario.audioDuration} transcript={scenario.customer} />
                    ) : (
                        <p className="ml-auto max-w-[95%] rounded-2xl rounded-br-md bg-emerald-100 px-3 py-2 text-sm leading-relaxed text-slate-950">
                            {scenario.customer}
                        </p>
                    )}
                </motion.div>
                <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.45, duration: 0.35 }}
                    className="max-w-[95%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm leading-relaxed whitespace-pre-line text-slate-950 shadow-sm"
                >
                    {scenario.agent}
                </motion.p>
            </div>
        </div>
    );
}

function AudioBubble({ duration, transcript }: { duration: string; transcript: string }) {
    return (
        <div className="ml-auto max-w-[95%] space-y-2">
            <div className="flex items-center gap-3 rounded-2xl rounded-br-md bg-emerald-100 px-3 py-2">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Play className="size-3.5 fill-current" aria-hidden />
                </span>
                <span className="flex flex-1 items-end gap-0.5" aria-hidden>
                    {WAVE.map((height, bar) => (
                        <span
                            key={bar}
                            className="w-1 rounded-full bg-emerald-700/70"
                            style={{ height }}
                        />
                    ))}
                </span>
                <span className="text-xs font-semibold text-slate-700 tabular-nums">{duration}</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 italic">“{transcript}”</p>
        </div>
    );
}

const WAVE = ["0.5rem", "0.9rem", "0.7rem", "1.15rem", "0.6rem", "1rem", "0.75rem", "1.2rem", "0.55rem", "0.85rem"] as const;

function SpeedLink() {
    return (
        <div className="flex items-center justify-center gap-2 lg:flex-col" aria-hidden>
            <span className="h-px w-8 bg-emerald-300 lg:h-8 lg:w-px" />
            <motion.span
                initial={{ scale: 0.9, opacity: 0.6 }}
                animate={{ scale: [0.96, 1.04, 0.96], opacity: 1 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 tabular-nums"
            >
                2.4s
            </motion.span>
            <span className="h-px w-8 bg-emerald-300 lg:h-8 lg:w-px" />
        </div>
    );
}

function PanelPane({ scenario }: { scenario: FlowScenario }) {
    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-white shadow-xl">
            <p className="text-xs font-bold tracking-wide text-emerald-300 uppercase">Painel Zampell</p>
            <p className="mt-2 text-sm font-semibold tabular-nums">{scenario.orderLabel}</p>
            <ul className="mt-3 space-y-2">
                {scenario.badges.map((badge, badgeIndex) => (
                    <motion.li
                        key={badge}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 + badgeIndex * 0.18, duration: 0.35 }}
                        className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200"
                    >
                        <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{badge}</span>
                    </motion.li>
                ))}
            </ul>
        </div>
    );
}
