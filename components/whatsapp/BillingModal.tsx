"use client";

import React from "react";
import { X } from "lucide-react";
import type { Usage } from "@/lib/whatsapp/types";

interface BillingModalProps {
    usage: Usage | null;
    pendingText: string | null;
    busy: boolean;
    onClose: () => void;
    onAcceptOverage: () => void;
    onUpgrade: () => void;
}

export function BillingModal({
    usage,
    pendingText,
    busy,
    onClose,
    onAcceptOverage,
    onUpgrade,
}: BillingModalProps) {
    const usageLabel = (() => {
        if (!usage) return null;
        const lim = usage.limit_per_month;
        return lim == null
            ? `Uso: ${usage.used}`
            : `Uso: ${usage.used} / ${lim} • Excedente previsto: ${usage.will_overage_by}`;
    })();

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
                if (e.currentTarget === e.target && !busy) onClose();
            }}
        >
            <div
                className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
                role="dialog"
                aria-modal="true"
                aria-label="Limite do plano atingido"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <p className="text-sm font-bold text-primary">Limite do plano atingido</p>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Fechar modal"
                        className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                    <p>Você atingiu o limite mensal de mensagens. Escolha uma opção para continuar:</p>
                    {usageLabel && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{usageLabel}</p>
                    )}
                    {pendingText && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Mensagem:{" "}
                            <span className="font-medium">
                                &ldquo;{pendingText.slice(0, 80)}{pendingText.length > 80 ? "…" : ""}&rdquo;
                            </span>
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onAcceptOverage}
                        disabled={busy}
                        className="rounded-lg border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-500 dark:text-orange-400"
                    >
                        {busy ? "Processando..." : "Aceitar cobrança extra"}
                    </button>
                    <button
                        onClick={onUpgrade}
                        disabled={busy}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                    >
                        {busy ? "Processando..." : "Upgrade ERP Full"}
                    </button>
                </div>
            </div>
        </div>
    );
}
