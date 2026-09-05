"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { PlanCheckoutModal } from "@/components/billing/PlanCheckoutModal";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type {
    BillingStatusJson,
    PlanBillingVariant,
    RenthusBillingAddr,
    RenthusCardForm,
} from "@/lib/billing/planBillingTypes";
import { resolveCheckoutDisplayAmountBrl } from "@/lib/billing/resolveCheckoutDisplayAmount";
import {
    formatCardExpiryInput,
    formatCardNumberInput,
    formatCvvInput,
} from "@/lib/billing/cardInputFormatters";

const PAGARME_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? "";

function Field({
    label,
    value,
    onChange,
    placeholder = "",
    type = "text",
    maxLength,
    inputMode,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    maxLength?: number;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                maxLength={maxLength}
                inputMode={inputMode}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
        </div>
    );
}

type Props = {
    variant: PlanBillingVariant;
    billingData: BillingStatusJson;
    nomeFantasia: string;
    checkoutOpen: boolean;
    onCheckoutOpenChange: (open: boolean) => void;
    renthusPayMode: "pix" | "card";
    onPayModeChange: (mode: "pix" | "card") => void;
    renthusCard: RenthusCardForm;
    setRenthusCard: React.Dispatch<React.SetStateAction<RenthusCardForm>>;
    renthusInstallments: number;
    setRenthusInstallments: (n: number) => void;
    cardAddr: RenthusBillingAddr;
    setCardAddr: React.Dispatch<React.SetStateAction<RenthusBillingAddr>>;
    cepLoading: boolean;
    onCepBlur: (cep: string) => void;
    pixLoading: boolean;
    pixCopied: boolean;
    pixLiveCode: string | null;
    pixLiveUrl: string | null;
    setPixCopied: (v: boolean) => void;
    cardPayLoading: boolean;
    billingSuccessMsg: string | null;
    billingErr: string | null;
    setBillingErr: (msg: string | null) => void;
    onGeneratePix: () => void;
    onPayCard: () => void;
    savedCardBusyId?: string | null;
    onPaySavedCard?: (cardId: string) => void;
};

export function PlanCheckoutSection({
    variant,
    billingData,
    nomeFantasia,
    checkoutOpen,
    onCheckoutOpenChange,
    renthusPayMode,
    onPayModeChange,
    renthusCard,
    setRenthusCard,
    renthusInstallments,
    setRenthusInstallments,
    cardAddr,
    setCardAddr,
    cepLoading,
    onCepBlur,
    pixLoading,
    pixCopied,
    pixLiveCode,
    pixLiveUrl,
    setPixCopied,
    cardPayLoading,
    billingSuccessMsg,
    billingErr,
    setBillingErr,
    onGeneratePix,
    onPayCard,
    savedCardBusyId = null,
    onPaySavedCard,
}: Props) {
    const sub = billingData.pagarme_subscription;
    const st = sub?.status ?? "";
    const rawPlan = String(sub?.plan ?? billingData.plan_key ?? "");
    const pk =
        rawPlan === "market"
            ? ("market" as const)
            : rawPlan === "pro" || rawPlan === "complete"
              ? ("pro" as const)
              : ("essencial" as const);

    const isFirstPayment =
        st === "trial" || st === "pending_setup" || st === "pending_payment";
    const mp = billingData.monthly_prices_brl ?? {};
    const pendInv = billingData.pending_invoice;
    const pendRecord = pendInv;
    const isAnnualCycle =
        String(sub?.billing_period ?? "month").toLowerCase() === "year" ||
        pendInv?.kind === "year";

    const priceFallback = pk === "market" ? 397 : pk === "pro" ? 279 : 197;
    const refAmount = resolveCheckoutDisplayAmountBrl({
        planKey: pk,
        billingPeriod: sub?.billing_period,
        pendingInvoiceKind: pendInv?.kind,
        pendingInvoiceAmount: pendRecord ? Number(pendRecord.amount) : null,
        checkoutAmountBrl: billingData.checkout_amount_brl,
        monthlyPricesBrl: mp as Partial<Record<typeof pk, number>>,
        yearlyPricesBrl: (billingData.yearly_prices_brl ?? {}) as Partial<
            Record<typeof pk, number>
        >,
        fallbackMonthlyBrl: (mp as Record<string, number | undefined>)[pk] ?? priceFallback,
    });

    const fromPendPix =
        typeof (pendRecord as { pix_qr_code?: string | null } | null | undefined)?.pix_qr_code ===
        "string"
            ? String((pendRecord as { pix_qr_code: string }).pix_qr_code).trim()
            : "";
    const fromInvPix = (billingData.pending_invoice?.pix_qr_code ?? "").trim();
    const pixUrl =
        pixLiveUrl ??
        (pendRecord?.pagarme_payment_url?.startsWith("http")
            ? pendRecord.pagarme_payment_url
            : null);
    const pixCode = (pixLiveCode ?? "").trim() || fromPendPix || fromInvPix;

    const pendingKind = String(pendInv?.kind ?? "");
    const hasCheckoutIntent = Boolean(
        sub?.pending_upgrade_plan_key || sub?.pending_checkout_intent
    );
    const hasOpenObligation = Boolean(pendRecord) && Number(pendRecord?.amount ?? 0) > 0;
    const nextBillingMs = sub?.next_billing_at ? Date.parse(sub.next_billing_at) : Number.NaN;
    const prepaidActive =
        st === "active" &&
        Number.isFinite(nextBillingMs) &&
        nextBillingMs > Date.now() &&
        !hasOpenObligation;

    const showPay =
        st === "trial" ||
        st === "pending_setup" ||
        st === "pending_payment" ||
        st === "overdue" ||
        st === "blocked" ||
        (st === "active" && (!prepaidActive || hasOpenObligation || hasCheckoutIntent));

    if (!showPay) return null;

    let paymentTitle =
        variant === "pay"
            ? "Concluir pagamento"
            : isFirstPayment
              ? "Ativar plano RenthusAgent"
              : isAnnualCycle
                ? "Pagar plano anual RenthusAgent"
                : "Pagar mensalidade RenthusAgent";

    let paymentDesc = isAnnualCycle
        ? "Plano anual à vista. Próxima renovação em 12 meses após o pagamento."
        : variant === "pay"
          ? "Escolha PIX ou cartão de crédito para liberar seu acesso."
          : isFirstPayment
            ? "Primeira mensalidade — após o pagamento as cobranças seguem a cada 30 dias."
            : "Mensalidade recorrente. Próximo vencimento em 30 dias após o pagamento.";

    if (pendingKind === "plan_upgrade" || sub?.pending_upgrade_plan_key) {
        const dest = pendInv?.target_plan_key || sub?.pending_upgrade_plan_key || "";
        const destLabel =
            dest === "market"
                ? "Market"
                : dest === "pro"
                  ? "Pro"
                  : dest === "essencial"
                    ? "Essencial"
                    : "plano superior";
        if (
            pendingKind === "period_switch" ||
            sub?.pending_checkout_intent === "upgrade_to_annual"
        ) {
            paymentTitle = `Upgrade para ${destLabel} anual`;
            paymentDesc =
                "Valor = anual do plano escolhido menos o crédito do mês já pago. Após o pagamento a renovação passa a ser anual.";
        } else {
            paymentTitle = `Confirmar upgrade para ${destLabel}`;
            paymentDesc =
                "Pague no checkout (PIX ou cartão) para aplicar o upgrade. A data de renovação não muda.";
        }
    } else if (
        pendingKind === "period_switch" ||
        sub?.pending_checkout_intent === "period_switch"
    ) {
        paymentTitle = "Migrar para plano anual";
        paymentDesc =
            "Pague no checkout para migrar ao ciclo anual. Após o pagamento a renovação passa a ser anual.";
    } else if (sub?.pending_checkout_intent === "upgrade_to_annual") {
        const dest = sub?.pending_upgrade_plan_key || "";
        const destLabel =
            dest === "market" ? "Market" : dest === "pro" ? "Pro" : "plano superior";
        paymentTitle = `Upgrade para ${destLabel} anual`;
        paymentDesc = "Valor = anual do plano escolhido menos o crédito do mês já pago.";
    }

    const amountLabel =
        refAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) +
        (pendRecord ? " · cobrança em aberto" : " · gerado ao confirmar");

    const statusBanners = (
        <>
            {st === "blocked" ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    Acesso suspenso. Pague: cartão aprovado libera na hora; PIX libera quando o banco
                    confirmar.
                </div>
            ) : null}
            {st === "pending_payment" || st === "pending_setup" ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    Pagamento inicial pendente. Escolha PIX ou cartão para começar.
                </div>
            ) : null}
            {st === "overdue" ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    Mensalidade em aberto. Escolha PIX ou cartão.
                </div>
            ) : null}
        </>
    );

    const cardForm = (
        <div className="space-y-3">
            {!PAGARME_PUBLIC_KEY ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                    Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY para pagar com cartão.
                </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
                <Field
                    label="Nome no cartão"
                    value={renthusCard.holder}
                    onChange={(v) => setRenthusCard((c) => ({ ...c, holder: v }))}
                    placeholder={nomeFantasia || "Como no cartão"}
                />
                <Field
                    label="Número"
                    value={renthusCard.number}
                    onChange={(v) =>
                        setRenthusCard((c) => ({ ...c, number: formatCardNumberInput(v) }))
                    }
                    placeholder="0000 0000 0000 0000"
                    inputMode="numeric"
                />
                <Field
                    label="Validade (MM/AA)"
                    value={renthusCard.exp}
                    onChange={(v) =>
                        setRenthusCard((c) => ({ ...c, exp: formatCardExpiryInput(v) }))
                    }
                    placeholder="08/28"
                    maxLength={5}
                    inputMode="numeric"
                />
                <Field
                    label="CVV"
                    value={renthusCard.cvv}
                    onChange={(v) => setRenthusCard((c) => ({ ...c, cvv: formatCvvInput(v) }))}
                    placeholder="123"
                    type="password"
                    maxLength={4}
                    inputMode="numeric"
                />
            </div>
            <div>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Parcelas
                </span>
                <Select
                    value={String(renthusInstallments)}
                    onValueChange={(v) => setRenthusInstallments(Number(v))}
                >
                    <SelectTrigger className="mt-1 max-w-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                            <SelectItem key={n} value={String(n)}>
                                {n}x
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Endereço de cobrança
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                            CEP
                        </span>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={cardAddr.cep}
                                onChange={(e) =>
                                    setCardAddr((a) => ({ ...a, cep: e.target.value }))
                                }
                                onBlur={(e) => onCepBlur(e.target.value)}
                                placeholder="00000-000"
                                maxLength={9}
                                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            {cepLoading ? (
                                <Loader2 className="mt-2 h-4 w-4 shrink-0 animate-spin text-violet-500" />
                            ) : null}
                        </div>
                    </div>
                    <Field
                        label="Número"
                        value={cardAddr.numero}
                        onChange={(v) => setCardAddr((a) => ({ ...a, numero: v }))}
                        placeholder="123"
                    />
                    <div className="sm:col-span-2">
                        <Field
                            label="Endereço (logradouro)"
                            value={cardAddr.endereco}
                            onChange={(v) => setCardAddr((a) => ({ ...a, endereco: v }))}
                            placeholder="Rua Exemplo"
                        />
                    </div>
                    <Field
                        label="Bairro"
                        value={cardAddr.bairro}
                        onChange={(v) => setCardAddr((a) => ({ ...a, bairro: v }))}
                        placeholder="Centro"
                    />
                    <Field
                        label="Cidade"
                        value={cardAddr.cidade}
                        onChange={(v) => setCardAddr((a) => ({ ...a, cidade: v }))}
                        placeholder="São Paulo"
                    />
                    <Field
                        label="UF"
                        value={cardAddr.uf}
                        onChange={(v) =>
                            setCardAddr((a) => ({ ...a, uf: v.toUpperCase().slice(0, 2) }))
                        }
                        placeholder="SP"
                    />
                </div>
            </div>
        </div>
    );

    const modal = (
        <PlanCheckoutModal
            open={checkoutOpen}
            onOpenChange={onCheckoutOpenChange}
            title={paymentTitle}
            description={paymentDesc}
            amountLabel={amountLabel}
            successMsg={billingSuccessMsg}
            errorMsg={billingErr}
            payMode={renthusPayMode}
            onPayModeChange={onPayModeChange}
            pixLoading={pixLoading}
            pixUrl={pixUrl}
            pixCode={pixCode}
            pixCopied={pixCopied}
            onGeneratePix={onGeneratePix}
            onCopyPix={() => {
                void (async () => {
                    try {
                        await navigator.clipboard.writeText(pixCode);
                        setPixCopied(true);
                        setTimeout(() => setPixCopied(false), 2000);
                    } catch {
                        setBillingErr("Não foi possível copiar.");
                    }
                })();
            }}
            cardForm={cardForm}
            onPayCard={onPayCard}
            cardPayLoading={cardPayLoading}
            savedCards={(billingData.saved_cards ?? [])
                .filter((c) => Boolean(c.id))
                .map((c) => ({
                    id: c.id,
                    brand: c.brand,
                    last_four: c.last_four,
                    holder: c.holder,
                    exp: c.exp,
                    is_default: c.is_default,
                }))}
            savedCardBusyId={savedCardBusyId}
            onPaySavedCard={onPaySavedCard}
        />
    );

    // /plano: só Dialog (abre ao clicar no plano). /plano/pagar: checkout inline.
    if (variant === "full") {
        return modal;
    }

    let pixButtonLabel = "Gerar código PIX";
    if (pixLoading) pixButtonLabel = "Gerando…";
    else if (pixUrl || pixCode) pixButtonLabel = "Gerar novo / atualizar PIX";

    return (
        <div className="rounded-2xl border-2 border-violet-300/70 bg-gradient-to-br from-violet-50 via-white to-zinc-50 p-5 shadow-sm dark:border-violet-800 dark:from-violet-950/30 dark:via-zinc-900 dark:to-zinc-950">
            {statusBanners}
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">{paymentTitle}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">{paymentDesc}</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Valor:{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {refAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
                {pendRecord ? " · cobrança em aberto" : " · gerado ao confirmar"}
            </p>
            {pendInv?.due_at && !isFirstPayment ? (
                <p className="mt-0.5 text-xs text-zinc-500">
                    Vencimento:{" "}
                    {new Date(pendInv.due_at).toLocaleString("pt-BR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                    })}
                </p>
            ) : null}
            {billingSuccessMsg ? (
                <div
                    data-testid="billing-checkout-success"
                    className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                >
                    {billingSuccessMsg}
                </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={renthusPayMode === "pix" ? "default" : "outline"}
                    onClick={() => onPayModeChange("pix")}
                >
                    PIX
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={renthusPayMode === "card" ? "default" : "outline"}
                    onClick={() => onPayModeChange("card")}
                >
                    Cartão de crédito
                </Button>
            </div>
            {renthusPayMode === "pix" ? (
                <div className="mt-4 space-y-4">
                    {pixUrl || pixCode ? (
                        <div className="flex flex-wrap gap-3">
                            {pixUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={pixUrl}
                                    alt="QR PIX"
                                    className="h-40 w-40 rounded-xl border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700"
                                />
                            ) : null}
                            {pixCode ? (
                                <div className="min-w-[200px] flex-1">
                                    <textarea
                                        readOnly
                                        className="w-full rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-900"
                                        rows={5}
                                        value={pixCode}
                                        onFocus={(e) => e.target.select()}
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="mt-2"
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(pixCode);
                                                setPixCopied(true);
                                                setTimeout(() => setPixCopied(false), 2000);
                                            } catch {
                                                setBillingErr("Não foi possível copiar.");
                                            }
                                        }}
                                    >
                                        {pixCopied ? "Copiado!" : "Copiar PIX"}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <Button type="button" onClick={onGeneratePix} disabled={pixLoading}>
                        {pixButtonLabel}
                    </Button>
                    <p className="text-xs text-zinc-500">
                        O plano é liberado automaticamente quando o pagamento for confirmado pelo
                        Pagar.me.
                    </p>
                </div>
            ) : null}
            {renthusPayMode === "card" ? (
                <div className="mt-4 min-w-0 space-y-4">
                    {onPaySavedCard && (billingData.saved_cards?.length ?? 0) > 0 ? (
                        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Cartões salvos
                            </p>
                            <ul className="space-y-2">
                                {(billingData.saved_cards ?? [])
                                    .filter((c) => Boolean(c.id))
                                    .map((c) => (
                                        <li
                                            key={c.id}
                                            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/80"
                                        >
                                            <span className="min-w-0 truncate">
                                                <span className="font-medium capitalize">
                                                    {c.brand || "Cartão"}
                                                </span>
                                                {c.last_four ? ` •••• ${c.last_four}` : ""}
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
                                                disabled={Boolean(savedCardBusyId) || cardPayLoading}
                                                onClick={() => onPaySavedCard(c.id)}
                                            >
                                                {savedCardBusyId === c.id
                                                    ? "Cobrando…"
                                                    : "Usar este cartão"}
                                            </Button>
                                        </li>
                                    ))}
                            </ul>
                        </div>
                    ) : null}
                    {cardForm}
                    <Button type="button" onClick={onPayCard} disabled={cardPayLoading}>
                        {cardPayLoading ? "Processando…" : "Pagar com cartão"}
                    </Button>
                    <p className="text-xs text-zinc-500">
                        Aprovado na hora = plano liberado imediatamente. Em análise = liberamos quando
                        o banco confirmar (webhook).
                    </p>
                </div>
            ) : null}
        </div>
    );
}
