"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { brlToNumber, formatBRL } from "@/lib/orders/helpers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    MESA_PAYMENT_LABELS,
    MESA_PAYMENT_METHODS,
    splitPreview,
    type MesaPaymentMethod,
    type PayerBasis,
} from "@/src/mesa/domain/paymentParts";

export type MesaReleaseItem = {
    id: string;
    product_name: string;
    qty: number;
    unit_price: number;
    combo_label: string | null;
};

export type MesaReleasePart =
    | { method: MesaPaymentMethod; amount: number }
    | { method: MesaPaymentMethod; lines: Array<{ item_id: string; qty: number }> };

type PayerDraft = {
    key: string;
    amount: string;
    method: MesaPaymentMethod;
    basis: PayerBasis;
    qty: Record<string, number>;
};

const inputCls = cn(
    "w-full rounded-lg border border-border bg-background-card px-3 py-2 text-sm text-foreground",
    "placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent"
);
const sectionCls = "rounded-xl border border-border bg-background-card p-4";

function brl(n: number) {
    return `R$ ${formatBRL(n)}`;
}

export function useMesaRelease(due: number, items: MesaReleaseItem[]) {
    const [splitMode, setSplitMode] = useState<"single" | "split">("single");
    const [payers, setPayers] = useState<PayerDraft[]>([]);

    const splitLines = items.map((it) => ({
        id: it.id,
        qty: Number(it.qty),
        unitPrice: Number(it.unit_price),
    }));
    const itemsSubtotal = Math.round(splitLines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) * 100) / 100;
    const serviceFee = Math.round((due - itemsSubtotal) * 100) / 100;
    const preview = splitPreview(
        splitLines,
        payers.map((payer) => ({
            basis: payer.basis,
            amount: payer.amount.trim() === "" ? null : brlToNumber(payer.amount),
            qty: payer.qty,
        })),
        due,
        serviceFee,
    );
    const remainder = preview.remainder;
    const canFinish = payers.length > 0
        && preview.qtyOk
        && remainder === 0
        && preview.amounts.every((amount) => amount != null && amount > 0);

    const pendingQty = useCallback((itemId: string, exceptKey?: string) => {
        const line = splitLines.find((entry) => entry.id === itemId);
        const used = payers
            .filter((payer) => payer.basis === "item" && payer.key !== exceptKey)
            .reduce((sum, payer) => sum + (payer.qty[itemId] ?? 0), 0);
        return Math.max(0, (line?.qty ?? 0) - used);
    }, [payers, splitLines]);

    const openWholeBill = useCallback(() => {
        setSplitMode("single");
        setPayers([{ key: crypto.randomUUID(), amount: formatBRL(due), method: "pix", basis: "value", qty: {} }]);
    }, [due]);

    useEffect(() => {
        if (splitMode !== "single") return;
        setPayers((rows) => {
            if (rows.length !== 1 || rows[0]?.basis !== "value") return rows;
            const next = formatBRL(due);
            if (rows[0].amount === next) return rows;
            return [{ ...rows[0], amount: next }];
        });
    }, [due, splitMode]);

    function startSplit() {
        setSplitMode("split");
        setPayers([]);
    }

    function reset() {
        setSplitMode("single");
        setPayers([]);
    }

    function addPayer() {
        setPayers((rows) => [
            ...rows,
            {
                key: crypto.randomUUID(),
                amount: remainder > 0 ? formatBRL(remainder) : "",
                method: "pix",
                basis: "value",
                qty: {},
            },
        ]);
    }

    function setPayerBasis(key: string, basis: PayerBasis) {
        setPayers((rows) => rows.map((row) => {
            if (row.key !== key || row.basis === basis) return row;
            if (basis === "item") {
                const qty: Record<string, number> = {};
                for (const line of splitLines) qty[line.id] = 0;
                return { ...row, basis, qty };
            }
            const others = preview.amounts.reduce<number>((sum, amount, index) => {
                if (payers[index]?.key === key || amount == null) return sum;
                return sum + amount;
            }, 0);
            const pending = Math.round((due - others) * 100) / 100;
            return { ...row, basis, amount: pending > 0 ? formatBRL(pending) : "" };
        }));
    }

    function buildParts(): MesaReleasePart[] {
        return payers.map((payer) =>
            payer.basis === "item"
                ? {
                    method: payer.method,
                    lines: items
                        .map((it) => ({ item_id: it.id, qty: payer.qty[it.id] ?? 0 }))
                        .filter((line) => line.qty > 0),
                }
                : { method: payer.method, amount: brlToNumber(payer.amount) },
        );
    }

    return {
        splitMode,
        payers,
        preview,
        remainder,
        canFinish,
        pendingQty,
        openWholeBill,
        startSplit,
        reset,
        addPayer,
        setPayerBasis,
        setPayers,
        buildParts,
        due,
    };
}

export type MesaReleaseState = ReturnType<typeof useMesaRelease>;

export type MesaFeeInfo = {
    offered: boolean;
    waived: boolean;
    amount: number;
    name: string;
    itemsSubtotal: number;
    total: number;
};

export function MesaFeeSummary({
    fee,
    busy,
    onToggle,
}: {
    fee: MesaFeeInfo;
    busy: boolean;
    onToggle: (waived: boolean) => void;
}) {
    const showFee = fee.offered && (fee.waived || fee.amount > 0);
    return (
        <div className="space-y-2 border-t border-border pt-3 text-sm">
            <div className="flex items-center justify-between gap-3">
                <span className="text-foreground-muted">Itens</span>
                <span className="tabular-nums">{brl(fee.itemsSubtotal)}</span>
            </div>
            {showFee && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-foreground-muted">{fee.waived ? "Taxa retirada" : fee.name}</span>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="tabular-nums">{fee.waived ? "—" : brl(fee.amount)}</span>
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onToggle(!fee.waived)}>
                            {fee.waived ? "Recolocar taxa" : "Retirar taxa"}
                        </Button>
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between gap-3 font-semibold">
                <span>Total</span>
                <span className="font-bold text-primary tabular-nums">{brl(fee.total)}</span>
            </div>
        </div>
    );
}

export function MesaReleaseBody({
    state,
    items,
    fee,
    busy,
    onToggleFee,
}: {
    state: MesaReleaseState;
    items: MesaReleaseItem[];
    fee?: MesaFeeInfo;
    busy?: boolean;
    onToggleFee?: (waived: boolean) => void;
}) {
    const { splitMode, payers, preview, remainder, canFinish, pendingQty, openWholeBill, startSplit, addPayer, setPayerBasis, setPayers, due } = state;
    return (
        <div className="space-y-4">
            {fee && onToggleFee && <MesaFeeSummary fee={fee} busy={busy === true} onToggle={onToggleFee} />}
            <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={splitMode === "single" ? "default" : "outline"} aria-pressed={splitMode === "single"} onClick={openWholeBill}>
                    Conta inteira
                </Button>
                <Button type="button" size="sm" variant={splitMode === "split" ? "default" : "outline"} aria-pressed={splitMode === "split"} onClick={startSplit}>
                    Dividir conta
                </Button>
            </div>
            {splitMode === "split" && payers.length === 0 && (
                <p className="text-sm text-foreground-muted">A divisão começa limpa. Cada pagador entra por valor, com o que ainda falta, e pode marcar item.</p>
            )}
            {splitMode === "single" && (
                <p className="text-xs text-foreground-muted">Um pagamento com o valor da conta. Divida só se mais de uma pessoa for pagar.</p>
            )}
            <div className="space-y-3">
                {payers.map((payer, index) => (
                    <div key={payer.key} className={sectionCls}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold">Pagador {index + 1}</p>
                            {payer.basis === "item" && (
                                <p className="text-sm font-semibold text-primary">{brl(preview.amounts[index] ?? 0)}</p>
                            )}
                        </div>
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            {splitMode === "split" && (
                                <ToggleGroup
                                    type="single"
                                    variant="outline"
                                    size="sm"
                                    value={payer.basis}
                                    onValueChange={(value) => {
                                        if (value === "value" || value === "item") setPayerBasis(payer.key, value);
                                    }}
                                    aria-label={`Como o pagador ${index + 1} divide`}
                                    className="dark:border dark:border-zinc-500 dark:bg-zinc-900"
                                >
                                    <ToggleGroupItem value="value" className="min-w-14 px-3 text-zinc-800 hover:bg-zinc-200 data-[state=on]:!bg-primary data-[state=on]:!text-white dark:text-zinc-100 dark:hover:bg-zinc-700">
                                        Valor
                                    </ToggleGroupItem>
                                    <ToggleGroupItem value="item" className="min-w-14 px-3 text-zinc-800 hover:bg-zinc-200 data-[state=on]:!bg-primary data-[state=on]:!text-white dark:text-zinc-100 dark:hover:bg-zinc-700">
                                        Item
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            )}
                            <Select
                                value={payer.method}
                                onValueChange={(method) =>
                                    setPayers((rows) =>
                                        rows.map((row) =>
                                            row.key === payer.key ? { ...row, method: method as MesaPaymentMethod } : row
                                        )
                                    )
                                }
                            >
                                <SelectTrigger aria-label={`Forma do pagador ${index + 1}`} className="w-full sm:w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MESA_PAYMENT_METHODS.map((method) => (
                                        <SelectItem key={method} value={method}>
                                            {MESA_PAYMENT_LABELS[method]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {splitMode === "split" && (
                                <Button type="button" variant="outline" size="sm" onClick={() => setPayers((rows) => rows.filter((row) => row.key !== payer.key))}>
                                    Remover
                                </Button>
                            )}
                        </div>
                        {payer.basis === "item" ? (
                            <ul className="grid gap-2">
                                {items.map((it) => {
                                    const marked = payer.qty[it.id] ?? 0;
                                    const cap = pendingQty(it.id, payer.key);
                                    return (
                                        <li key={it.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                                            <span className="min-w-0 truncate">
                                                {it.combo_label || it.product_name}
                                                <span className="text-foreground-muted"> · {it.qty} na comanda</span>
                                            </span>
                                            <div className="inline-flex shrink-0 items-center rounded-lg border border-border">
                                                <Button type="button" variant="ghost" size="icon" aria-label={`Diminuir ${it.product_name}`} disabled={marked <= 0} onClick={() => setPayers((rows) => rows.map((row) => row.key === payer.key ? { ...row, qty: { ...row.qty, [it.id]: Math.max(0, marked - 1) } } : row))}>
                                                    <Minus className="h-3.5 w-3.5" />
                                                </Button>
                                                <span className="min-w-[1.75rem] text-center text-xs font-bold tabular-nums">{marked}</span>
                                                <Button type="button" variant="ghost" size="icon" aria-label={`Aumentar ${it.product_name}`} disabled={marked >= cap} onClick={() => setPayers((rows) => rows.map((row) => row.key === payer.key ? { ...row, qty: { ...row.qty, [it.id]: Math.min(cap, marked + 1) } } : row))}>
                                                    <Plus className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <input
                                inputMode="decimal"
                                placeholder="Valor"
                                aria-label={`Valor do pagador ${index + 1}`}
                                value={payer.amount}
                                onChange={(e) => setPayers((rows) => rows.map((row) => (row.key === payer.key ? { ...row, amount: e.target.value } : row)))}
                                className={inputCls}
                            />
                        )}
                    </div>
                ))}
                {payers.length > 0 && !canFinish && (
                    <p className="text-xs font-medium text-rose-600">
                        {!preview.qtyOk
                            ? "A quantidade marcada não fecha. Sem pagador por valor, tem de bater com a linha. Com pagador por valor, não pode passar da linha."
                            : remainder > 0
                                ? `Ainda falta ${brl(remainder)} para fechar a conta.`
                                : remainder < 0
                                    ? `A soma passou ${brl(Math.abs(remainder))} da conta.`
                                    : "Cada pagador precisa de um valor."}
                    </p>
                )}
                {items.length === 0 && (
                    <p className="text-sm text-foreground-muted">Esta comanda não tem itens para finalizar.</p>
                )}
                {splitMode === "split" && (
                    <Button type="button" variant="outline" onClick={addPayer}>
                        <Plus className="h-4 w-4" />
                        Adicionar pagador
                    </Button>
                )}
            </div>
            <p className="text-[11px] text-foreground-muted">Conta {brl(due)}. A mesa fica livre e a conta vai para a fila do caixa.</p>
        </div>
    );
}

export function MesaReleaseFooter({
    state,
    busy,
    msg,
    onRelease,
    onBack,
}: {
    state: MesaReleaseState;
    busy: boolean;
    msg: string | null;
    onRelease: () => void;
    onBack: () => void;
}) {
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Button type="button" className="w-full sm:w-auto" disabled={busy || !state.canFinish} onClick={onRelease}>
                {busy ? "Finalizando..." : "Finalizar"}
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={onBack}>
                Voltar
            </Button>
            <p className="text-[11px] text-foreground-muted">
                Conta {brl(state.due)} · restante {brl(state.remainder)}
            </p>
            {msg && <span className="text-xs font-medium text-rose-600">{msg}</span>}
        </div>
    );
}
