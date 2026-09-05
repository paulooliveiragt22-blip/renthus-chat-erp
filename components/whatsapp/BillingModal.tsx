"use client";

import React from "react";
import Link from "next/link";
import type { Usage } from "@/lib/whatsapp/types";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface BillingModalProps {
    usage: Usage | null;
    pendingText: string | null;
    busy: boolean;
    onClose: () => void;
    onAcceptOverage: () => void;
}

export function BillingModal({
    usage,
    pendingText,
    busy,
    onClose,
    onAcceptOverage,
}: BillingModalProps) {
    const usageLabel = (() => {
        if (!usage) return null;
        const lim = usage.limit_per_month;
        return lim == null
            ? `Uso: ${usage.used}`
            : `Uso: ${usage.used} / ${lim} • Excedente previsto: ${usage.will_overage_by}`;
    })();

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent
                hideClose
                className="max-w-md gap-0 overflow-hidden rounded-2xl p-0"
                aria-describedby={undefined}
            >
                <DialogHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3 text-left">
                    <DialogTitle className="text-sm font-bold text-primary">
                        Limite do plano atingido
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-3 p-4 text-sm text-zinc-700 dark:text-zinc-300">
                    <p>Você atingiu o limite mensal de mensagens. Escolha uma opção para continuar:</p>
                    {usageLabel && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{usageLabel}</p>
                    )}
                    {pendingText && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Mensagem:{" "}
                            <span className="font-medium">
                                &ldquo;{pendingText.slice(0, 80)}
                                {pendingText.length > 80 ? "…" : ""}&rdquo;
                            </span>
                        </p>
                    )}
                </div>

                <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={onAcceptOverage}
                        disabled={busy}
                        className="rounded-lg border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-500 dark:text-orange-400"
                    >
                        {busy ? "Processando..." : "Aceitar cobrança extra"}
                    </button>
                    <Link
                        href="/configuracoes?tab=plano"
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                        onClick={onClose}
                    >
                        Ver planos (upgrade)
                    </Link>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
