"use client";

import React from "react";
import type { CartItem } from "@/lib/orders/types";
import { buildVariantTexts, formatBRL } from "@/lib/orders/helpers";
import { Minus, Plus, Trash2 } from "lucide-react";

export default function CartRow({
    item,
    onDec,
    onInc,
    onRemove,
}: {
    item: CartItem;
    onDec: () => void;
    onInc: () => void;
    onRemove: () => void;
}) {
    const { title, sub } = buildVariantTexts(item.variant);
    // Nível 2: remove separador "•" para ficar "descricao volume" em vez de "descricao • volume"
    const detailLine = sub ? sub.replaceAll(" • ", " ") : null;

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
            <div className="min-w-0 flex-1">
                {/* Nível 1 — PRODUCTS.NAME + modo */}
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-50 uppercase">
                        {title}
                    </span>
                    <span className="shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700 px-1.5 py-px text-[9px] font-bold text-zinc-600 dark:text-zinc-300">
                        {item.mode === "unit" ? "UN" : "CX"}
                    </span>
                </div>
                {/* Nível 2 — embalagem */}
                {detailLine && (
                    <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 pl-0.5">{detailLine}</div>
                )}
                <div className="mt-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                    <span className="font-bold">{item.qty}</span>
                    {" × "}
                    <span className="font-bold">R$ {formatBRL(item.price)}</span>
                    {" = "}
                    <span className="font-bold text-violet-700 dark:text-violet-400">R$ {formatBRL(item.qty * item.price)}</span>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <button
                    onClick={onDec}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                    <Minus className="h-3 w-3" />
                </button>
                <button
                    onClick={onInc}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                    <Plus className="h-3 w-3" />
                </button>
                <button
                    onClick={onRemove}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-500 transition-colors hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}
