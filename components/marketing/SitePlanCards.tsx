"use client";

import { Check } from "lucide-react";

export type ChatPlanOption = {
    offeringId: string;
    label: string;
    price: string;
    note: string | null;
};

export type ChatPlanCard = {
    title: string;
    benefits: string[];
    options: ChatPlanOption[];
};

function optionOf(raw: unknown): ChatPlanOption | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.offeringId !== "string" || typeof row.label !== "string" || typeof row.price !== "string") return null;
    return {
        offeringId: row.offeringId,
        label: row.label,
        price: row.price,
        note: typeof row.note === "string" && row.note.length > 0 ? row.note : null,
    };
}

export function readPlanCards(raw: unknown): ChatPlanCard[] {
    if (!Array.isArray(raw)) return [];
    const cards: ChatPlanCard[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        if (typeof row.title !== "string" || !Array.isArray(row.options)) continue;
        const options = row.options.flatMap((option) => {
            const parsed = optionOf(option);
            return parsed ? [parsed] : [];
        });
        if (options.length === 0) continue;
        const benefits = Array.isArray(row.benefits)
            ? row.benefits.filter((line): line is string => typeof line === "string" && line.trim().length > 0)
            : [];
        cards.push({ title: row.title, benefits, options });
    }
    return cards;
}

export function planChoiceText(title: string, option: ChatPlanOption): string {
    if (option.label === "Quero este") return title;
    return `${title} ${option.label.toLocaleLowerCase("pt-BR")}`;
}

function actionLabel(option: ChatPlanOption): string {
    if (option.label === "Mensal") return "Quero o mensal";
    if (option.label === "Anual") return "Quero o anual";
    if (option.label === "Quero este") return "Quero conversar";
    return option.label;
}

export function SitePlanCards({
    cards,
    disabled,
    onSelect,
}: {
    cards: readonly ChatPlanCard[];
    disabled: boolean;
    onSelect: (text: string, offeringId: string) => void;
}) {
    if (cards.length === 0) return null;
    return (
        <div className="mt-2 flex flex-col gap-2">
            {cards.map((card) => (
                <article
                    key={card.title}
                    className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <h3 className="text-sm font-extrabold tracking-tight text-slate-950 dark:text-zinc-50">{card.title}</h3>
                    {card.benefits.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                            {card.benefits.map((benefit) => (
                                <li key={benefit} className="flex items-start gap-2 text-xs leading-snug text-slate-600 dark:text-zinc-300">
                                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                    <span>{benefit}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="mt-3 flex flex-col gap-1.5">
                        {card.options.map((option) => (
                            <button
                                key={option.offeringId}
                                type="button"
                                disabled={disabled}
                                onClick={() => onSelect(planChoiceText(card.title, option), option.offeringId)}
                                className={
                                    option.label === "Anual"
                                        ? "rounded-full bg-emerald-500 px-3 py-2 text-left text-sm font-semibold text-slate-950 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                                        : "rounded-full border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-800"
                                }
                            >
                                <span className="flex items-baseline justify-between gap-3">
                                    <span>{actionLabel(option)}</span>
                                    <span className="tabular-nums">{option.price}</span>
                                </span>
                                {option.note ? <span className="mt-0.5 block text-xs font-medium opacity-80">{option.note}</span> : null}
                            </button>
                        ))}
                    </div>
                </article>
            ))}
        </div>
    );
}
