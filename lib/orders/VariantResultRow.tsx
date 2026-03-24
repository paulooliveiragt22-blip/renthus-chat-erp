"use client";

import React from "react";
import type { DraftQty, Variant } from "@/lib/orders/types";
import { buildVariantTexts, formatBRL, toQtyInt } from "@/lib/orders/helpers";
import { ShoppingCart } from "lucide-react";

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
                        <> · Cx: <span className="font-bold">R$ {formatBRL(v.case_price)}</span>
                            {v.case_qty ? <span className="text-zinc-400"> ({v.case_qty} un)</span> : null}
                        </>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 items-end gap-2">
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Un</span>
                    <input
                        value={draft.unit}
                        onChange={(e) => onDraftChange({ unit: e.target.value })}
                        placeholder="0"
                        inputMode="numeric"
                        className="w-14 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-center text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                </div>

                {v.has_case && (
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Cx</span>
                        <input
                            value={draft.box}
                            onChange={(e) => onDraftChange({ box: e.target.value })}
                            placeholder="0"
                            inputMode="numeric"
                            className="w-14 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-center text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        />
                    </div>
                )}

                <button
                    disabled={!canAdd}
                    onClick={() => onAdd(unitN, boxN)}
                    className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ShoppingCart className="h-3 w-3" />
                    Add
                </button>
            </div>
        </div>
    );
}
