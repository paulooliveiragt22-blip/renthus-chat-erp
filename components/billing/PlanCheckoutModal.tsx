"use client";

import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PayMode = "pix" | "card";

export type CheckoutSavedCard = {
    id: string;
    brand: string;
    last_four: string;
    holder: string;
    exp: string;
    is_default?: boolean;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    amountLabel: string;
    successMsg?: string | null;
    errorMsg?: string | null;
    payMode: PayMode;
    onPayModeChange: (mode: PayMode) => void;
    pixLoading: boolean;
    pixUrl: string | null;
    pixCode: string;
    pixCopied: boolean;
    onGeneratePix: () => void;
    onCopyPix: () => void;
    cardForm: React.ReactNode;
    onPayCard: () => void;
    cardPayLoading: boolean;
    savedCards?: CheckoutSavedCard[];
    savedCardBusyId?: string | null;
    onPaySavedCard?: (cardId: string) => void;
    footerHint?: string;
};

/**
 * Checkout de upgrade / migração anual / cobrança — Dialog Radix.
 */
export function PlanCheckoutModal({
    open,
    onOpenChange,
    title,
    description,
    amountLabel,
    successMsg,
    errorMsg,
    payMode,
    onPayModeChange,
    pixLoading,
    pixUrl,
    pixCode,
    pixCopied,
    onGeneratePix,
    onCopyPix,
    cardForm,
    onPayCard,
    cardPayLoading,
    savedCards = [],
    savedCardBusyId = null,
    onPaySavedCard,
    footerHint = "O plano é liberado automaticamente quando o pagamento for confirmado pelo Pagar.me.",
}: Props) {
    let pixButtonLabel = "Gerar código PIX";
    if (pixLoading) pixButtonLabel = "Gerando…";
    else if (pixUrl || pixCode) pixButtonLabel = "Gerar novo / atualizar PIX";

    const usableCards = savedCards.filter((c) => Boolean(c.id));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-x-hidden overflow-y-auto border-[#16364d]/30">
                <DialogHeader>
                    <DialogTitle className="text-[#16364d]">{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Valor:{" "}
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {amountLabel}
                    </span>
                </p>

                {successMsg ? (
                    <div
                        data-testid="billing-checkout-success"
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                    >
                        {successMsg}
                    </div>
                ) : null}
                {errorMsg ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                        {errorMsg}
                    </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={payMode === "pix" ? "default" : "outline"}
                        size="sm"
                        className={payMode === "pix" ? "bg-[#16364d] hover:bg-[#1f4a68]" : undefined}
                        onClick={() => onPayModeChange("pix")}
                    >
                        PIX
                    </Button>
                    <Button
                        type="button"
                        variant={payMode === "card" ? "default" : "outline"}
                        size="sm"
                        className={
                            payMode === "card" ? "bg-[#16364d] hover:bg-[#1f4a68]" : undefined
                        }
                        onClick={() => onPayModeChange("card")}
                    >
                        Cartão de crédito
                    </Button>
                </div>

                {payMode === "pix" ? (
                    <div className="space-y-3">
                        {pixUrl || pixCode ? (
                            <div className="flex min-w-0 flex-wrap gap-3">
                                {pixUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={pixUrl}
                                        alt="QR PIX"
                                        className="h-36 w-36 shrink-0 rounded-xl border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700"
                                    />
                                ) : null}
                                {pixCode ? (
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <textarea
                                            readOnly
                                            className="w-full max-w-full rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-900"
                                            rows={4}
                                            value={pixCode}
                                            onFocus={(e) => e.target.select()}
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={onCopyPix}
                                        >
                                            {pixCopied ? "Copiado!" : "Copiar código"}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <Button
                            type="button"
                            disabled={pixLoading}
                            onClick={onGeneratePix}
                            className="w-full bg-[#16364d] text-white hover:bg-[#1f4a68]"
                        >
                            {pixLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            {pixButtonLabel}
                        </Button>
                    </div>
                ) : (
                    <div className="min-w-0 space-y-4">
                        {usableCards.length && onPaySavedCard ? (
                            <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                    Cartões salvos
                                </p>
                                <ul className="space-y-2">
                                    {usableCards.map((c) => (
                                        <li
                                            key={c.id}
                                            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/80"
                                        >
                                            <span className="min-w-0 truncate">
                                                <span className="font-medium capitalize">
                                                    {c.brand || "Cartão"}
                                                </span>
                                                {c.last_four ? ` •••• ${c.last_four}` : ""}
                                                {c.exp ? ` · ${c.exp}` : ""}
                                                {c.is_default ? (
                                                    <span className="ml-2 text-[11px] font-semibold text-emerald-600">
                                                        padrão
                                                    </span>
                                                ) : null}
                                            </span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="shrink-0 bg-[#16364d] text-white hover:bg-[#1f4a68]"
                                                disabled={
                                                    cardPayLoading ||
                                                    savedCardBusyId === c.id ||
                                                    Boolean(savedCardBusyId)
                                                }
                                                onClick={() => onPaySavedCard(c.id)}
                                            >
                                                {savedCardBusyId === c.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : null}
                                                {savedCardBusyId === c.id
                                                    ? "Cobrando…"
                                                    : "Usar este cartão"}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            {usableCards.length ? (
                                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                    Ou pagar com novo cartão
                                </p>
                            ) : null}
                            {cardForm}
                            <Button
                                type="button"
                                disabled={cardPayLoading || Boolean(savedCardBusyId)}
                                onClick={onPayCard}
                                className="w-full bg-[#16364d] text-white hover:bg-[#1f4a68]"
                            >
                                {cardPayLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : null}
                                {cardPayLoading ? "Processando…" : "Pagar com cartão"}
                            </Button>
                        </div>
                    </div>
                )}

                <p className="text-[11px] text-zinc-500">{footerHint}</p>
            </DialogContent>
        </Dialog>
    );
}
