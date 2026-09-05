"use client";

import { useState } from "react";
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
        onError("");
        if (!PAGARME_PUBLIC_KEY) {
            onError("Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY.");
            return;
        }
        const validated = validateRenthusCardCheckout(card, addr, nomeFantasia);
        if ("error" in validated) {
            onError(validated.error);
            return;
        }
        const { exp, num, cvv, holder, addrCep } = validated;
        const companyDoc = classifyFiscalDocument(cnpj);

        setLoading(true);
        try {
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
                onError(json.error ?? "Não foi possível adicionar o cartão.");
                return;
            }
            onSuccess(json.message ?? "Cartão adicionado.");
            onOpenChange(false);
            setCard({ holder: "", number: "", exp: "", cvv: "" });
            await onAdded();
        } catch (e: unknown) {
            onError(e instanceof Error ? e.message : "Erro de conexão.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Adicionar forma de pagamento</DialogTitle>
                    <DialogDescription>
                        O cartão é tokenizado no Pagar.me e fica disponível para renovação
                        automática. Nada é cobrado agora.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 text-sm">
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">Titular</span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={card.holder}
                            onChange={(e) => setCard((c) => ({ ...c, holder: e.target.value }))}
                            autoComplete="cc-name"
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
                        />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-xs font-semibold text-zinc-600">Endereço</span>
                        <input
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                            value={addr.endereco}
                            onChange={(e) => setAddr((a) => ({ ...a, endereco: e.target.value }))}
                        />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        <label className="grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Nº</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.numero}
                                onChange={(e) => setAddr((a) => ({ ...a, numero: e.target.value }))}
                            />
                        </label>
                        <label className="col-span-2 grid gap-1">
                            <span className="text-xs font-semibold text-zinc-600">Bairro</span>
                            <input
                                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                                value={addr.bairro}
                                onChange={(e) => setAddr((a) => ({ ...a, bairro: e.target.value }))}
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
                            />
                        </label>
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button type="button" disabled={loading} onClick={() => void submit()}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Salvar cartão
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
