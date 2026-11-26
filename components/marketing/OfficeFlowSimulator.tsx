"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Calendar, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

type Bubble = {
    id: string;
    from: "customer" | "agent";
    text: string;
    choices?: readonly string[];
};

type Scene = {
    id: "agenda" | "quote";
    tab: string;
    bubbles: readonly Bubble[];
};

const SCENES: readonly Scene[] = [
    {
        id: "agenda",
        tab: "Agenda",
        bubbles: [
            { id: "a1", from: "customer", text: "Oi, quero marcar uma avaliação terça à tarde." },
            { id: "a2", from: "agent", text: "Tenho terça às 14h ou às 16h. Qual fica melhor?", choices: ["Terça 14h", "Terça 16h"] },
            { id: "a3", from: "customer", text: "Terça 14h" },
            { id: "a4", from: "agent", text: "Confirmado. Terça, 14h. A avaliação entrou na agenda." },
        ],
    },
    {
        id: "quote",
        tab: "Orçamento",
        bubbles: [
            { id: "c1", from: "customer", text: "Boa tarde! Queria um orçamento da cozinha." },
            { id: "c2", from: "agent", text: "Olá, tudo bem? Você já tem projeto?" },
            { id: "c3", from: "customer", text: "Tenho sim." },
            { id: "c4", from: "agent", text: "Manda pra mim que monto o orçamento pra você." },
        ],
    },
];

export function OfficeFlowSimulator() {
    const [sceneId, setSceneId] = useState<Scene["id"]>("agenda");
    const scene = SCENES.find((item) => item.id === sceneId) ?? SCENES[0];
    const step = useScript(scene.bubbles.length, scene.id);
    const confirmed = step >= scene.bubbles.length;

    return (
        <div className="mx-auto mt-14 w-full max-w-6xl px-4 sm:px-6">
            <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)]">
                <div className="flex border-b border-slate-200/80 px-4 py-3 sm:justify-end">
                    <div role="tablist" aria-label="O que a conversa grava no painel" className="flex gap-2">
                        {SCENES.map((item) => {
                            const selected = item.id === scene.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    onClick={() => setSceneId(item.id)}
                                    className={cn(
                                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-200",
                                        selected ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    )}
                                >
                                    {item.tab}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="grid gap-4 p-4 md:grid-cols-2 md:p-6">
                    <WhatsAppPane bubbles={scene.bubbles} step={step} />
                    <DashboardPane sceneId={scene.id} confirmed={confirmed} />
                </div>
            </div>
        </div>
    );
}

function useScript(length: number, key: string): number {
    const [step, setStep] = useState(length);

    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
            setStep(length);
            return;
        }

        let timer = 0;
        let cancelled = false;
        const advance = (next: number) => {
            if (cancelled) return;
            setStep(next);
            const done = next >= length;
            timer = window.setTimeout(() => advance(done ? 0 : next + 1), done ? 2400 : 800);
        };

        setStep(0);
        timer = window.setTimeout(() => advance(1), 800);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [length, key]);

    return step;
}

function WhatsAppPane({ bubbles, step }: { bubbles: readonly Bubble[]; step: number }) {
    const visible = bubbles.slice(0, step);
    return (
        <div className="flex min-h-[26rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#efeae2] shadow-sm">
            <div className="flex items-center gap-3 bg-[#075e54] px-3 py-2.5 text-white">
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold" aria-hidden>
                    S
                </span>
                <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">Sua empresa</span>
                    <span className="block text-xs text-white/80">online</span>
                </span>
            </div>
            <div className="flex flex-1 flex-col justify-end gap-2 px-3 py-3" aria-live="polite">
                {visible.map((bubble) => (
                    <motion.div
                        key={bubble.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className={cn("max-w-[85%]", bubble.from === "agent" ? "mr-auto" : "ml-auto")}
                    >
                        <div
                            className={cn(
                                "rounded-2xl px-3 py-2 text-sm leading-relaxed text-slate-950 shadow-sm",
                                bubble.from === "customer" ? "rounded-br-md bg-[#d9fdd3]" : "rounded-bl-md bg-white"
                            )}
                        >
                            <p>{bubble.text}</p>
                            {bubble.choices ? (
                                <div className="mt-2 flex flex-col gap-1">
                                    {bubble.choices.map((choice) => (
                                        <p key={choice} className="rounded-lg border border-slate-200 py-1.5 text-center text-sm font-semibold text-[#027eb5]">
                                            {choice}
                                        </p>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </motion.div>
                ))}
            </div>
            <div className="bg-[#f0f2f5] px-3 py-2">
                <p className="rounded-full bg-white px-3 py-2 text-sm text-slate-400">Mensagem</p>
            </div>
        </div>
    );
}

function DashboardPane({ sceneId, confirmed }: { sceneId: Scene["id"]; confirmed: boolean }) {
    return (
        <div className="flex min-h-[26rem] overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-sm">
            <nav aria-label="Painel de exemplo" className="flex w-14 shrink-0 flex-col gap-1 border-r border-zinc-200 bg-white p-2 sm:w-36">
                <p className="hidden px-2 py-2 text-sm font-bold text-zinc-900 sm:block">Office</p>
                <PanelNav active={sceneId === "agenda"} icon={<Calendar className="size-4" aria-hidden />} label="Agenda" />
                <PanelNav active={sceneId === "quote"} icon={<FileText className="size-4" aria-hidden />} label="Orçamento" />
            </nav>
            <div className="min-w-0 flex-1 p-3 sm:p-4">
                {sceneId === "agenda" ? <AgendaBoard confirmed={confirmed} /> : <QuoteBoard confirmed={confirmed} />}
            </div>
        </div>
    );
}

function PanelNav({ active, icon, label }: { active: boolean; icon: ReactNode; label: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold sm:justify-start",
                active ? "bg-emerald-50 text-emerald-800" : "text-zinc-500"
            )}
        >
            {icon}
            <span className="hidden sm:inline">{label}</span>
        </span>
    );
}

function AgendaBoard({ confirmed }: { confirmed: boolean }) {
    return (
        <div>
            <h3 className="text-base font-bold text-zinc-900">Agenda</h3>
            <ul className="mt-3 flex flex-col gap-2">
                <StaticRow title="Retorno" detail="Segunda, 09:00 · Marina" />
                {confirmed ? (
                    <motion.li
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-emerald-200 bg-white px-3 py-3"
                    >
                        <p className="truncate font-medium text-zinc-900">Avaliação</p>
                        <p className="truncate text-sm text-zinc-500">Terça, 14:00 · Ana Souza</p>
                    </motion.li>
                ) : null}
            </ul>
        </div>
    );
}

function QuoteBoard({ confirmed }: { confirmed: boolean }) {
    return (
        <div>
            <h3 className="text-base font-bold text-zinc-900">Orçamentos</h3>
            <ul className="mt-3 flex flex-col gap-2">
                <StaticRow title="Banheiro" detail="Enviado · Paulo" />
                {confirmed ? (
                    <motion.li
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-emerald-200 bg-white px-3 py-3"
                    >
                        <p className="truncate font-medium text-zinc-900">Cozinha</p>
                        <p className="truncate text-sm text-zinc-500">Tem projeto · Ana Souza · montando</p>
                    </motion.li>
                ) : null}
            </ul>
        </div>
    );
}

function StaticRow({ title, detail }: { title: string; detail: string }) {
    return (
        <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
            <p className="truncate font-medium text-zinc-900">{title}</p>
            <p className="truncate text-sm text-zinc-500">{detail}</p>
        </li>
    );
}
