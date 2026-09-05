"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pagarmeCreateCardToken } from "@/lib/pagarme/cardTokenBrowser";
import { validateRenthusCardCheckout } from "@/lib/billing/validateRenthusCardCheckout";
import { classifyFiscalDocument } from "@/lib/billing/brazilianFiscalDocument";
import {
    formatCardExpiryInput,
    formatCardNumberInput,
    formatCvvInput,
} from "@/lib/billing/cardInputFormatters";
import { lookupCep } from "@/lib/address/cepLookup";
import type { RenthusBillingAddr, RenthusCardForm } from "@/lib/billing/planBillingTypes";

const PAGARME_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? "";
const BRAND = "#16364d";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nomeFantasia: string;
    cnpj: string;
    initialAddr: RenthusBillingAddr;
    onAdded: () => Promise<void> | void;
    onError: (msg: string) => void;
    onSuccess: (msg: string) => void;
};

export function AddPaymentMethodModal({
    open,
    onOpenChange,
    nomeFantasia,
    cnpj,
    initialAddr,
    onAdded,
    onError,
    onSuccess,
}: Props) {
    const [card, setCard] = useState<RenthusCardForm>({
        holder: "",
        number: "",
        exp: "",
        cvv: "",
    });
    const [addr, setAddr] = useState<RenthusBillingAddr>(initialAddr);
    const [loading, setLoading] = useState(false);
    const [cepLoading, setCepLoading] = useState(false);
    const [localSuccess, setLocalSuccess] = useState<string | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setAddr(initialAddr);
        setLocalSuccess(null);
        setLocalError(null);
        setCard({ holder: "", number: "", exp: "", cvv: "" });
    }, [open, initialAddr]);

    async function onCepBlur() {
        const digits = addr.cep.replaceAll(/\D/g, "");
        if (digits.length !== 8) return;
        setCepLoading(true);
        try {
            const data = await lookupCep(digits, 3000);
            if (!data) return;
            setAddr((prev) => ({
                ...prev,
                cep: data.cep,
                endereco: data.logradouro || prev.endereco,
                bairro: data.bairro || prev.bairro,
                cidade: data.localidade || prev.cidade,
                uf: data.uf || prev.uf,
            }));
        } finally {
            setCepLoading(false);
        }
    }

    async function submit() {
        setLocalError(null);
        onError("");
        if (!PAGARME_PUBLIC_KEY) {
            const msg = "Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY.";
            setLocalError(msg);
            onError(msg);
            return;
        }
        const validated = validateRenthusCardCheckout(card, addr, nomeFantasia);
        if ("error" in validated) {
            setLocalError(validated.error);
            onError(validated.error);
            return;
        }
        const { exp, num, cvv, holder, addrCep } = validated;
        const companyDoc = classifyFiscalDocument(cnpj);

        setLoading(true);
        try {
            // 1) Token no browser (PCI) — docs Pagar.me POST /tokens?appId=
            const cardToken = await pagarmeCreateCardToken(PAGARME_PUBLIC_KEY, {
                number: num,
                holder_name: holder,
                exp_month: exp.month,
                exp_year: exp.year,
                cvv,
                holder_document: companyDoc.valid ? companyDoc.digits : undefined,
                billing_address: {
                    street: addr.endereco.trim(),
                    number: addr.numero.trim(),
                    neighborhood: addr.bairro.trim(),
                    zipcode: addrCep,
                    city: addr.cidade.trim(),
                    state: addr.uf.trim().toUpperCase().slice(0, 2),
                    country: "BR",
                },
            });

            // 2) Salva na carteira do customer — POST /customers/{id}/cards { token }
            const res = await fetch("/api/billing/payment-methods", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    action: "add_card",
                    card_token: cardToken,
                    set_as_default: true,
                    billing_address: {
                        cep: addrCep,
                        endereco: addr.endereco.trim(),
                        numero: addr.numero.trim(),
                        bairro: addr.bairro.trim(),
                        cidade: addr.cidade.trim(),
                        uf: addr.uf.trim().toUpperCase().slice(0, 2),
                    },
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                message?: string;
            };
            if (!res.ok) {
                const msg = json.error ?? "Não foi possível adicionar o cartão.";
                setLocalError(msg);
                onError(msg);
                return;
            }
            const okMsg = json.message ?? "Cartão adicionado à carteira Pagar.me.";
            setLocalSuccess(okMsg);
            onSuccess(okMsg);
            await onAdded();
            window.setTimeout(() => {
                onOpenChange(false);
                setCard({ holder: "", number: "", exp: "", cvv: "" });
                setLocalSuccess(null);
            }, 900);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Erro de conexão.";
            setLocalError(msg);
            onError(msg);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-h-[90vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-x-hidden overflow-y-auto border-[#16364d]/30"
                style={{ borderTopWidth: 3, borderTopColor: BRAND }}
            >
                <DialogHeader>
                    <DialogTitle style={{ color: BRAND }}>Adicionar cartão</DialogTitle>
                    <DialogDescription>
                        Tokeniza no browser e grava na carteira do cliente no Pagar.me (sem cobrança
                        agora). O cartão fica disponível para renovação automática.
                    </DialogDescription>
                </DialogHeader>

                {localSuccess ? (
                    <div
                        data-testid="add-card-success"
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                    >
                        {localSuccess}
                    </div>
                ) : null}
                {localError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                        {localError}
                    </div>
                ) : null}

                <div className="grid min-w-0 gap-3 text-sm">
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">Titular</span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={card.holder}
                            onChange={(e) => setCard((c) => ({ ...c, holder: e.target.value }))}
                            autoComplete="cc-name"
                            disabled={Boolean(localSuccess)}
                        />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">Número</span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={card.number}
                            onChange={(e) =>
                                setCard((c) => ({
                                    ...c,
                                    number: formatCardNumberInput(e.target.value),
                                }))
                            }
                            inputMode="numeric"
                            autoComplete="cc-number"
                            disabled={Boolean(localSuccess)}
                        />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Validade</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={card.exp}
                                onChange={(e) =>
                                    setCard((c) => ({
                                        ...c,
                                        exp: formatCardExpiryInput(e.target.value),
                                    }))
                                }
                                placeholder="MM/AA"
                                inputMode="numeric"
                                autoComplete="cc-exp"
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">CVV</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={card.cvv}
                                onChange={(e) =>
                                    setCard((c) => ({
                                        ...c,
                                        cvv: formatCvvInput(e.target.value),
                                    }))
                                }
                                inputMode="numeric"
                                autoComplete="cc-csc"
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                    </div>
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">
                            CEP {cepLoading ? "(buscando…)" : ""}
                        </span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={addr.cep}
                            onChange={(e) => setAddr((a) => ({ ...a, cep: e.target.value }))}
                            onBlur={() => void onCepBlur()}
                            inputMode="numeric"
                            disabled={Boolean(localSuccess)}
                        />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">Endereço</span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={addr.endereco}
                            onChange={(e) => setAddr((a) => ({ ...a, endereco: e.target.value }))}
                            disabled={Boolean(localSuccess)}
                        />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        <label className="grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Nº</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.numero}
                                onChange={(e) => setAddr((a) => ({ ...a, numero: e.target.value }))}
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                        <label className="col-span-2 grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Bairro</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.bairro}
                                onChange={(e) => setAddr((a) => ({ ...a, bairro: e.target.value }))}
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <label className="col-span-2 grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Cidade</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.cidade}
                                onChange={(e) => setAddr((a) => ({ ...a, cidade: e.target.value }))}
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">UF</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.uf}
                                onChange={(e) =>
                                    setAddr((a) => ({
                                        ...a,
                                        uf: e.target.value.toUpperCase().slice(0, 2),
                                    }))
                                }
                                disabled={Boolean(localSuccess)}
                            />
                        </label>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={loading || Boolean(localSuccess)}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        disabled={loading || Boolean(localSuccess)}
                        onClick={() => void submit()}
                        className="bg-[#16364d] text-white hover:bg-[#1f4a68]"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Salvar cartão
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
