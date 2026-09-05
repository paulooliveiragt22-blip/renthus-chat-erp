"use client";

import React from "react";
import type { DraftQty, Variant } from "@/lib/orders/types";
import { buildVariantTexts, formatBRL, toQtyInt } from "@/lib/orders/helpers";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

const QTY_MAX = 999;

function QtyStepper({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (next: number) => void;
}) {
    const set = (n: number) => onChange(Math.min(QTY_MAX, Math.max(0, n)));

    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{label}</span>
            <div
                role="group"
                aria-label={`Quantidade ${label}`}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
            >
                <button
                    type="button"
                    aria-label={`Diminuir ${label}`}
                    disabled={value <= 0}
                    onClick={() => set(value - 1)}
                    className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-l-lg text-zinc-600 transition-colors",
                        "hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40",
                        "dark:text-zinc-300 dark:hover:bg-zinc-700"
                    )}
                >
                    <Minus className="h-3.5 w-3.5" />
                </button>
                <span
                    aria-live="polite"
                    className="min-w-[1.75rem] select-none text-center text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-50"
                >
                    {value}
                </span>
                <button
                    type="button"
                    aria-label={`Aumentar ${label}`}
                    disabled={value >= QTY_MAX}
                    onClick={() => set(value + 1)}
                    className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-r-lg text-zinc-600 transition-colors",
                        "hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40",
                        "dark:text-zinc-300 dark:hover:bg-zinc-700"
                    )}
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

export default function VariantResultRow({
    v,
    draft,
    onDraftChange,
    onAdd,
}: {
    v: Variant;
    draft: DraftQty;
    onDraftChange: (patch: Partial<DraftQty>) => void;
    onAdd: (unitQty: number, boxQty: number) => void;
}) {
    const { title, sub } = buildVariantTexts(v);
    const unitN = toQtyInt(draft.unit);
    const boxN = toQtyInt(draft.box);
    const canAdd = unitN > 0 || boxN > 0;

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-50">{title}</div>
                {sub && <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</div>}
                <div className="mt-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                    Un: <span className="font-bold">R$ {formatBRL(v.unit_price)}</span>
                    {v.has_case && v.case_price != null && (
                        <>
                            {" "}
                            · Cx: <span className="font-bold">R$ {formatBRL(v.case_price)}</span>
                            {v.case_qty ? <span className="text-zinc-400"> ({v.case_qty} un)</span> : null}
                        </>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 items-end gap-2">
                <QtyStepper
                    label="Un"
                    value={unitN}
                    onChange={(n) => onDraftChange({ unit: n > 0 ? String(n) : "" })}
                />

                {v.has_case ? (
                    <QtyStepper
                        label="Cx"
                        value={boxN}
                        onChange={(n) => onDraftChange({ box: n > 0 ? String(n) : "" })}
                    />
                ) : null}

                <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => onAdd(unitN, boxN)}
                    className="flex h-8 items-center gap-1 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ShoppingCart className="h-3 w-3" />
                    Add
                </button>
            </div>
        </div>
    );
}
