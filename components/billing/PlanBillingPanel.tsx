"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CircleDollarSign, CreditCard, Loader2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { useInvalidatePlanFeatures } from "@/lib/billing/usePlanFeatures";
import { pagarmeCreateCardToken } from "@/lib/pagarme/cardTokenBrowser";
import { lookupCep } from "@/lib/address/cepLookup";
import { validateRenthusCardCheckout } from "@/lib/billing/validateRenthusCardCheckout";
import type {
    BillingStatusJson,
    PlanBillingVariant,
    RenthusBillingAddr,
    RenthusCardForm,
} from "@/lib/billing/planBillingTypes";
import { PlanChangeCatalog } from "@/components/billing/PlanChangeCatalog";
import { PlanCheckoutSection } from "@/components/billing/PlanCheckoutSection";
import { AddPaymentMethodModal } from "@/components/billing/AddPaymentMethodModal";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG, normalizePlanKey } from "@/lib/billing/planCatalog";
import { formatInvoiceStatusLabel } from "@/lib/billing/contracts/status";

const PAGARME_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? "";

type CompanyBillingFields = {
    nome_fantasia: string | null;
    cnpj: string | null;
    cep: string | null;
    endereco: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
};

function SectionTitle({
    icon: Icon,
    title,
    desc,
}: {
    icon: React.ElementType;
    title: string;
    desc?: string;
}) {
    return (
        <div className="flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Icon className="h-[18px] w-[18px] text-violet-600" />
            </span>
            <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</p>
                {desc ? <p className="text-xs text-zinc-400">{desc}</p> : null}
            </div>
        </div>
    );
}

type PlanBillingPanelProps = {
    variant?: PlanBillingVariant;
};

export default function PlanBillingPanel({ variant = "full" }: PlanBillingPanelProps) {
    const { currentCompanyId: companyId, loading: workspaceLoading, reload: reloadWorkspace } = useWorkspace();
    const invalidatePlanFeatures = useInvalidatePlanFeatures();

    const [companyLoading, setCompanyLoading] = useState(true);
    const [nomeFantasia, setNomeFantasia] = useState("");
    const [cnpj, setCnpj] = useState("");

    const [billingLoading, setBillingLoading] = useState(false);
    const [billingData, setBillingData] = useState<BillingStatusJson | null>(null);
    const [billingErr, setBillingErr] = useState<string | null>(null);
    const [planSaving, setPlanSaving] = useState(false);
    const [pixLoading, setPixLoading] = useState(false);
    const [pixCopied, setPixCopied] = useState(false);
    const [pixLiveCode, setPixLiveCode] = useState<string | null>(null);
    const [pixLiveUrl, setPixLiveUrl] = useState<string | null>(null);
    const [renthusPayMode, setRenthusPayMode] = useState<"pix" | "card">("pix");
    const [renthusCard, setRenthusCard] = useState<RenthusCardForm>({
        holder: "",
        holder_document: "",
        number: "",
        exp: "",
        cvv: "",
    });
    const [renthusInstallments, setRenthusInstallments] = useState(1);
    const [cardPayLoading, setCardPayLoading] = useState(false);
    const [billingSuccessMsg, setBillingSuccessMsg] = useState<string | null>(null);
    const [cardAddr, setCardAddr] = useState<RenthusBillingAddr>({
        cep: "",
        endereco: "",
        numero: "",
        bairro: "",
        cidade: "",
        uf: "",
    });
    const [cepLoading, setCepLoading] = useState(false);
    const [savedCardBusyId, setSavedCardBusyId] = useState<string | null>(null);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [addCardOpen, setAddCardOpen] = useState(false);

    const loadCompany = useCallback(async () => {
        if (!companyId) {
            setCompanyLoading(false);
            return;
        }
        setCompanyLoading(true);
        try {
            const res = await fetch("/api/companies/update", { credentials: "include", cache: "no-store" });
            if (!res.ok) return;
            const json = (await res.json()) as { company?: CompanyBillingFields };
            const c = json.company;
            if (!c) return;
            setNomeFantasia(c.nome_fantasia ?? "");
            setCnpj(c.cnpj ?? "");
            setCardAddr({
                cep: c.cep ?? "",
                endereco: c.endereco ?? "",
                numero: c.numero ?? "",
                bairro: c.bairro ?? "",
                cidade: c.cidade ?? "",
                uf: c.uf ?? "",
            });
        } finally {
            setCompanyLoading(false);
        }
    }, [companyId]);

    const loadBilling = useCallback(async (opts?: { silent?: boolean }) => {
        if (!companyId) return;
        if (!opts?.silent) setBillingLoading(true);
        setBillingErr(null);
        try {
            const res = await fetch("/api/billing/status", { credentials: "include", cache: "no-store" });
            const json = (await res.json()) as BillingStatusJson;
            if (!res.ok) {
                setBillingErr(json.error ?? "Não foi possível carregar a cobrança.");
                setBillingData(null);
                return;
            }
            setBillingData(json);
            // PSP sync liberou / não há mais obrigação: limpa QR local (senão o gate não redireciona).
            const syncAction = json.psp_sync?.action;
            const noObligation = !json.pending_invoice;
            if (syncAction === "fulfilled" || noObligation) {
                setPixLiveCode(null);
                setPixLiveUrl(null);
            }
            if (syncAction === "fulfilled") {
                setBillingSuccessMsg("Pagamento confirmado. Plano liberado.");
                invalidatePlanFeatures();
            }
        } catch {
            setBillingErr("Erro de rede ao carregar cobrança.");
            setBillingData(null);
        } finally {
            if (!opts?.silent) setBillingLoading(false);
        }
    }, [companyId, invalidatePlanFeatures]);

    useEffect(() => {
        void loadCompany();
    }, [loadCompany]);

    useEffect(() => {
        if (!companyId && !workspaceLoading) {
            void reloadWorkspace();
        }
    }, [companyId, workspaceLoading, reloadWorkspace]);

    useEffect(() => {
        void loadBilling();
    }, [loadBilling]);

    // Gate /plano/pagar: após pagamento (ou se não há obrigação), manda para /ativar.
    // Trial/active COM invoice/setup pending no servidor permanece na tela.
    // pixLive* sozinho NÃO bloqueia redirect (estado local stale após pago).
    useEffect(() => {
        if (variant !== "pay") return;
        const st = billingData?.pagarme_subscription?.status;
        if (st !== "active" && st !== "trial") return;
        const hasServerPending = Boolean(billingData?.pending_invoice);
        if (hasServerPending) {
            const id = window.setInterval(() => {
                void loadBilling({ silent: true });
            }, 5000);
            return () => window.clearInterval(id);
        }
        window.location.assign("/ativar");
    }, [
        variant,
        billingData?.pagarme_subscription?.status,
        billingData?.pending_invoice,
        billingData?.psp_sync?.action,
        loadBilling,
    ]);

    async function changeRenthusPlan(plan: "essencial" | "pro" | "market") {
        setPlanSaving(true);
        setBillingErr(null);
        try {
            const res = await fetch("/api/billing/change-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Não foi possível alterar o plano.");
                return;
            }
            // QR local / order antigo fica inválido após rebill — força novo PIX no valor do plano.
            setPixLiveCode(null);
            setPixLiveUrl(null);
            await loadBilling({ silent: true });
            invalidatePlanFeatures();
        } catch {
            setBillingErr("Erro de rede.");
        } finally {
            setPlanSaving(false);
        }
    }

    async function fetchViaCep(rawCep: string) {
        const digits = rawCep.replaceAll(/\D/g, "");
        if (digits.length !== 8) return;
        setCepLoading(true);
        try {
            const data = await lookupCep(digits, 3000);
            if (!data) return;
            setCardAddr((prev) => ({
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

    async function openRenthusPix() {
        setPixLoading(true);
        setBillingErr(null);
        setBillingSuccessMsg(null);
        setPixCopied(false);
        try {
            const res = await fetch("/api/billing/create-invoice-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_method: "pix" }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Erro ao gerar PIX.");
                return;
            }
            if ((json as { payment_status?: string }).payment_status === "paid") {
                setPixLiveCode(null);
                setPixLiveUrl(null);
                setCheckoutOpen(false);
                setBillingSuccessMsg(
                    (json as { message?: string }).message ??
                        "Pagamento confirmado. Plano liberado."
                );
                invalidatePlanFeatures();
                if (variant === "pay") {
                    window.location.assign("/ativar");
                    return;
                }
                await loadBilling();
                return;
            }
            const code =
                typeof (json as { pix_qr_code?: unknown }).pix_qr_code === "string"
                    ? (json as { pix_qr_code: string }).pix_qr_code
                    : null;
            const url =
                typeof (json as { pix_qr_url?: unknown }).pix_qr_url === "string"
                    ? (json as { pix_qr_url: string }).pix_qr_url
                    : null;
            setPixLiveCode(code);
            setPixLiveUrl(url);
            if (code || url) {
                await loadBilling();
                setBillingSuccessMsg(
                    code
                        ? "PIX gerado. Copie o código ou escaneie o QR. Após o pagamento, o plano é liberado automaticamente."
                        : "PIX gerado (QR). Se o copia-e-cola não aparecer, clique em atualizar PIX."
                );
            } else {
                setBillingErr("PIX não retornado. Tente novamente ou fale com o suporte.");
            }
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setPixLoading(false);
        }
    }

    async function setDefaultSavedCard(cardId: string) {
        setSavedCardBusyId(cardId);
        setBillingErr(null);
        setBillingSuccessMsg(null);
        try {
            const res = await fetch("/api/billing/payment-methods", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ action: "set_default", card_id: cardId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Não foi possível definir o cartão padrão.");
                return;
            }
            setBillingSuccessMsg(
                (json as { message?: string }).message ?? "Cartão padrão atualizado."
            );
            await loadBilling();
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setSavedCardBusyId(null);
        }
    }

    async function payWithSavedCard(cardId: string) {
        setSavedCardBusyId(cardId);
        setBillingErr(null);
        setBillingSuccessMsg(null);
        try {
            const res = await fetch("/api/billing/create-invoice-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ payment_method: "credit_card", card_id: cardId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Cobrança no cartão falhou.");
                return;
            }
            const status = (json as { payment_status?: string }).payment_status;
            if (status === "paid") {
                setBillingSuccessMsg("Pagamento aprovado. Plano liberado.");
                setCheckoutOpen(false);
                invalidatePlanFeatures();
                if (variant === "pay") {
                    window.location.assign("/ativar");
                    return;
                }
            } else {
                setBillingSuccessMsg(
                    (json as { message?: string }).message ??
                        "Pagamento em análise. O plano libera quando o banco confirmar."
                );
            }
            await loadBilling();
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setSavedCardBusyId(null);
        }
    }

    async function payRenthusCard() {
        setBillingErr(null);
        setBillingSuccessMsg(null);
        if (!PAGARME_PUBLIC_KEY) {
            setBillingErr("Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY e cadastre o domínio no Pagar.me.");
            return;
        }
        const validated = validateRenthusCardCheckout(renthusCard, cardAddr, nomeFantasia);
        if ("error" in validated) {
            setBillingErr(validated.error);
            return;
        }
        const { exp, num, cvv, holder, holderDocument, addrCep } = validated;

        setCardPayLoading(true);
        try {
            let cardToken: string;
            try {
                cardToken = await pagarmeCreateCardToken(PAGARME_PUBLIC_KEY, {
                    number: num,
                    holder_name: holder,
                    exp_month: exp.month,
                    exp_year: exp.year,
                    cvv,
                    holder_document: holderDocument,
                    billing_address: {
                        street: cardAddr.endereco.trim(),
                        number: cardAddr.numero.trim(),
                        neighborhood: cardAddr.bairro.trim(),
                        zipcode: addrCep,
                        city: cardAddr.cidade.trim(),
                        state: cardAddr.uf.trim().toUpperCase().slice(0, 2),
                        country: "BR",
                    },
                });
            } catch (e) {
                setBillingErr(e instanceof Error ? e.message : "Cartão recusado.");
                return;
            }

            const res = await fetch("/api/billing/create-invoice-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payment_method: "credit_card",
                    card_token: cardToken,
                    installments: renthusInstallments,
                    holder_document: holderDocument,
                    billing_address: {
                        cep: addrCep,
                        endereco: cardAddr.endereco.trim(),
                        numero: cardAddr.numero.trim(),
                        bairro: cardAddr.bairro.trim(),
                        cidade: cardAddr.cidade.trim(),
                        uf: cardAddr.uf.trim().toUpperCase().slice(0, 2),
                    },
                }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Erro ao processar cartão.");
                return;
            }
            const status = (json as { payment_status?: string }).payment_status;
            const msg = (json as { message?: string }).message;
            await loadBilling();
            invalidatePlanFeatures();
            if (status === "paid") {
                setBillingSuccessMsg(msg ?? "Pagamento aprovado. Plano liberado.");
                setCheckoutOpen(false);
                if (variant === "pay") {
                    window.setTimeout(() => {
                        window.location.assign("/ativar");
                    }, 800);
                }
            } else {
                setBillingSuccessMsg(
                    msg ?? "Pagamento em análise. Quando aprovado, o plano será liberado automaticamente."
                );
            }
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setCardPayLoading(false);
        }
    }

    const loading = workspaceLoading || companyLoading || billingLoading;
    const paywallStatus = billingData?.pagarme_subscription?.status ?? "";
    const showReactivateHint = useMemo(
        () =>
            variant === "pay" &&
            ["abandoned", "blocked", "cancelled"].includes(String(paywallStatus).toLowerCase()),
        [variant, paywallStatus]
    );

    return (
        <div className="flex flex-col gap-6">
            {variant === "full" ? (
                <SectionTitle
                    icon={CircleDollarSign}
                    title="Plano e pagamentos RenthusAgent"
                    desc="Período de teste, mensalidade, PIX e cartões salvos no Pagar.me"
                />
            ) : null}

            {loading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
                </div>
            ) : null}

            {!loading && !billingData && !billingErr ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                    {workspaceLoading || !companyId
                        ? "Carregando sua empresa…"
                        : "Não foi possível carregar o checkout. Atualize a página ou tente novamente."}
                </div>
            ) : null}

            {!loading && billingErr ? (
                <div
                    data-testid="billing-checkout-error"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                >
                    {billingErr}
                </div>
            ) : null}

            {!loading && billingData ? (
                <div
                    className={
                        variant === "pay"
                            ? "grid gap-8 lg:grid-cols-2 lg:items-start"
                            : "flex flex-col gap-6"
                    }
                >
                    {variant !== "pay" ? (
                    <div>
                    {(() => {
                        const sub = billingData.pagarme_subscription;
                        const st = sub?.status ?? "";
                        const plan = sub?.plan ?? "";
                        const trialEnd = sub?.trial_ends_at
                            ? new Date(sub.trial_ends_at).toLocaleString("pt-BR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                              })
                            : null;
                        const nextBill = sub?.next_billing_at
                            ? new Date(sub.next_billing_at).toLocaleString("pt-BR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                              })
                            : null;
                        const lastPaid = sub?.last_paid_at
                            ? new Date(sub.last_paid_at).toLocaleString("pt-BR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                              })
                            : null;

                        const statusLabel =
                            st === "trial"
                                ? "Período de teste"
                                : st === "active"
                                  ? "Assinatura ativa"
                                  : st === "overdue"
                                    ? "Mensalidade em aberto"
                                    : st === "pending_payment" || st === "pending_setup"
                                      ? "Aguardando 1º pagamento"
                                      : st === "blocked"
                                          ? "Acesso suspenso"
                                          : st || "—";

                        return (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                        Situação
                                    </p>
                                    <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                        {statusLabel}
                                    </p>
                                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                        Plano atual:{" "}
                                        <span className="font-semibold">
                                            {billingData.plan_label ||
                                                (plan === "market"
                                                    ? "Market"
                                                    : plan === "pro" || plan === "complete"
                                                      ? "Pro"
                                                      : plan === "essencial" ||
                                                          plan === "bot" ||
                                                          plan === "starter"
                                                        ? "Essencial"
                                                        : plan || "—")}
                                        </span>
                                    </p>
                                </div>
                                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                        <CalendarClock className="h-3.5 w-3.5" />
                                        Datas
                                    </p>
                                    {st === "trial" && trialEnd ? (
                                        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                                            Teste gratuito até{" "}
                                            <span className="font-semibold">{trialEnd}</span>. Depois disso você
                                            paga a mensalidade aqui (PIX ou cartão).
                                        </p>
                                    ) : null}
                                    {(st === "active" || st === "overdue") && nextBill ? (
                                        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                                            Próxima cobrança prevista:{" "}
                                            <span className="font-semibold">{nextBill}</span>
                                        </p>
                                    ) : null}
                                    {lastPaid ? (
                                        <p className="mt-1 text-xs text-zinc-500">
                                            Último pagamento registrado: {lastPaid}
                                        </p>
                                    ) : null}
                                    {st === "trial" && !trialEnd ? (
                                        <p className="mt-2 text-sm text-zinc-500">
                                            Sem data de término do trial registrada.
                                        </p>
                                    ) : null}
                                    {st === "pending_payment" ? (
                                        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                                            Conclua o pagamento abaixo para liberar o acesso ao sistema.
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })()}
                    </div>
                    ) : null}

                    <div
                        className={
                            variant === "pay"
                                ? "lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0"
                                : undefined
                        }
                    >
                    <PlanCheckoutSection
                        variant={variant}
                        billingData={billingData}
                        nomeFantasia={nomeFantasia}
                        checkoutOpen={checkoutOpen}
                        onCheckoutOpenChange={setCheckoutOpen}
                        renthusPayMode={renthusPayMode}
                        onPayModeChange={setRenthusPayMode}
                        renthusCard={renthusCard}
                        setRenthusCard={setRenthusCard}
                        renthusInstallments={renthusInstallments}
                        setRenthusInstallments={setRenthusInstallments}
                        cardAddr={cardAddr}
                        setCardAddr={setCardAddr}
                        cepLoading={cepLoading}
                        onCepBlur={(cep) => { void fetchViaCep(cep); }}
                        pixLoading={pixLoading}
                        pixCopied={pixCopied}
                        pixLiveCode={pixLiveCode}
                        pixLiveUrl={pixLiveUrl}
                        setPixCopied={setPixCopied}
                        cardPayLoading={cardPayLoading}
                        billingSuccessMsg={billingSuccessMsg}
                        billingErr={billingErr}
                        setBillingErr={setBillingErr}
                        onGeneratePix={() => { void openRenthusPix(); }}
                        onPayCard={() => { void payRenthusCard(); }}
                        savedCardBusyId={savedCardBusyId}
                        onPaySavedCard={(cardId) => {
                            void payWithSavedCard(cardId);
                        }}
                    />
                    </div>

                    {(() => {
                        // R3-7 defense-in-depth: upgrade/downgrade só owner/admin.
                        // O servidor (change-plan/pending-plan-change) já bloqueia member;
                        // aqui esconde o catálogo mesmo se o read for afrouxado no futuro.
                        const callerRole = String(billingData.role ?? "").toLowerCase();
                        if (callerRole && callerRole !== "owner" && callerRole !== "admin") {
                            return null;
                        }
                        const st = String(billingData.pagarme_subscription?.status ?? "");
                        if (
                            st !== "trial" &&
                            st !== "active" &&
                            st !== "overdue" &&
                            st !== "pending_payment" &&
                            st !== "pending_setup"
                        ) {
                            return null;
                        }
                        const cur =
                            normalizePlanKey(
                                String(billingData.pagarme_subscription?.plan ?? "")
                            ) ?? "essencial";
                        const mp = billingData.monthly_prices_brl ?? {};
                        const yp = billingData.yearly_prices_brl ?? {};
                        const ys = billingData.yearly_savings_percent ?? {};
                        const neverPaid = !billingData.pagarme_subscription?.last_paid_at;
                        const initialCheckout =
                            variant === "pay" ||
                            neverPaid ||
                            st === "pending_payment" ||
                            st === "pending_setup";
                        return (
                            <div
                                className={
                                    variant === "pay"
                                        ? "lg:col-start-1 lg:row-start-1 min-w-0"
                                        : undefined
                                }
                            >
                            <PlanChangeCatalog
                                checkoutMode={variant === "pay" || neverPaid}
                                neverPaid={neverPaid}
                                initialCheckout={initialCheckout}
                                currentPlan={cur}
                                status={st}
                                billingPeriod={
                                    billingData.pagarme_subscription?.billing_period
                                }
                                pendingPlanKey={
                                    billingData.pagarme_subscription?.pending_plan_key
                                }
                                pendingPlanChangeAt={
                                    billingData.pagarme_subscription?.pending_plan_change_at
                                }
                                nextBillingAt={
                                    billingData.pagarme_subscription?.next_billing_at
                                }
                                prices={{
                                    essencial: mp.essencial ?? 279,
                                    pro: mp.pro ?? 349,
                                    market: mp.market ?? 449,
                                }}
                                yearlyPrices={{
                                    essencial:
                                        yp.essencial ??
                                        PLAN_CATALOG.essencial.yearlyPriceCents / 100,
                                    pro: yp.pro ?? PLAN_CATALOG.pro.yearlyPriceCents / 100,
                                    market:
                                        yp.market ?? PLAN_CATALOG.market.yearlyPriceCents / 100,
                                }}
                                yearlySavingsPercent={{
                                    essencial: ys.essencial,
                                    pro: ys.pro,
                                    market: ys.market,
                                }}
                                planSaving={planSaving}
                                onUpgradeOrTrial={(plan) => void changeRenthusPlan(plan)}
                                onReload={async () => {
                                    await loadBilling({ silent: true });
                                    invalidatePlanFeatures();
                                }}
                                onError={(msg) => setBillingErr(msg)}
                                onSuccess={(msg) => {
                                    setBillingErr(null);
                                    setBillingSuccessMsg(msg);
                                }}
                                onCheckoutNeeded={() => setCheckoutOpen(true)}
                                onPrepayPeriodChange={
                                    initialCheckout
                                        ? async (period) => {
                                              setPlanSaving(true);
                                              setBillingErr(null);
                                              try {
                                                  const res = await fetch(
                                                      "/api/billing/set-period",
                                                      {
                                                          method: "POST",
                                                          headers: {
                                                              "Content-Type": "application/json",
                                                          },
                                                          credentials: "include",
                                                          body: JSON.stringify({ period }),
                                                      }
                                                  );
                                                  const json = await res
                                                      .json()
                                                      .catch(() => ({}));
                                                  if (!res.ok) {
                                                      setBillingErr(
                                                          (json as { error?: string }).error ??
                                                              "Não foi possível alterar o ciclo."
                                                      );
                                                      return;
                                                  }
                                                  setPixLiveCode(null);
                                                  setPixLiveUrl(null);
                                                  await loadBilling({ silent: true });
                                              } catch {
                                                  setBillingErr("Erro de rede.");
                                              } finally {
                                                  setPlanSaving(false);
                                              }
                                          }
                                        : undefined
                                }
                            />
                            </div>
                        );
                    })()}

                    {variant === "full" ? (
                        <SectionTitle
                            icon={CreditCard}
                            title="Meus cartões"
                            desc="Cartões salvos no Pagar.me para renovação automática"
                        />
                    ) : null}

                    {variant !== "pay" ? (
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <p className="text-xs text-zinc-500">
                                Defina o cartão padrão para renovação automática. Se houver fatura
                                aberta, use &quot;Tentar de novo&quot;.
                            </p>
                            <Button
                                type="button"
                                size="sm"
                                className="bg-[#16364d] text-white hover:bg-[#1f4a68]"
                                onClick={() => setAddCardOpen(true)}
                            >
                                Adicionar cartão
                            </Button>
                        </div>
                        {!billingData.saved_cards?.length ? (
                            <p className="mt-2 text-xs text-zinc-500">
                                Nenhum cartão cadastrado ainda. Adicione um cartão para renovação
                                automática.
                            </p>
                        ) : null}
                        {billingData.saved_cards?.length ? (
                            <ul className="mt-3 space-y-2">
                                {billingData.saved_cards.map((c) => (
                                    <li
                                        key={c.id || c.last_four}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/80"
                                    >
                                        <span>
                                            <span className="font-medium capitalize">{c.brand || "Cartão"}</span>
                                            {c.last_four ? ` •••• ${c.last_four}` : ""}
                                            {c.exp ? ` · validade ${c.exp}` : ""}
                                            {c.is_default ? (
                                                <span className="ml-2 text-[11px] font-semibold text-emerald-600">
                                                    padrão
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="flex flex-wrap gap-2">
                                            {!c.is_default && c.id ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={savedCardBusyId === c.id}
                                                    onClick={() => {
                                                        void setDefaultSavedCard(c.id);
                                                    }}
                                                >
                                                    {savedCardBusyId === c.id ? "…" : "Tornar padrão"}
                                                </Button>
                                            ) : null}
                                            {c.id &&
                                            (billingData.pending_invoice ||
                                                billingData.is_blocked) ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={savedCardBusyId === c.id}
                                                    onClick={() => {
                                                        void payWithSavedCard(c.id);
                                                    }}
                                                >
                                                    {savedCardBusyId === c.id ? "Cobrando…" : "Tentar de novo"}
                                                </Button>
                                            ) : null}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        <AddPaymentMethodModal
                            open={addCardOpen}
                            onOpenChange={setAddCardOpen}
                            nomeFantasia={nomeFantasia}
                            cnpj={cnpj}
                            initialAddr={cardAddr}
                            onAdded={async () => {
                                await loadBilling({ silent: true });
                            }}
                            onError={(msg) => setBillingErr(msg || null)}
                            onSuccess={(msg) => {
                                setBillingErr(null);
                                setBillingSuccessMsg(msg);
                            }}
                        />
                    </div>
                    ) : null}

                    {variant !== "pay" && billingData.invoice_history?.length ? (
                        <div>
                            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                                Histórico de faturas
                            </p>
                            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
                                        <tr>
                                            <th className="px-3 py-2">Valor</th>
                                            <th className="px-3 py-2">Status</th>
                                            <th className="px-3 py-2">Vencimento</th>
                                            <th className="px-3 py-2">Pago em</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {billingData.invoice_history.map((inv) => (
                                            <tr
                                                key={inv.id}
                                                className="border-t border-zinc-100 dark:border-zinc-800"
                                            >
                                                <td className="px-3 py-2">
                                                    {Number(inv.amount).toLocaleString("pt-BR", {
                                                        style: "currency",
                                                        currency: "BRL",
                                                    })}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {formatInvoiceStatusLabel(inv.status)}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-zinc-600">
                                                    {new Date(inv.due_at).toLocaleDateString("pt-BR")}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-zinc-600">
                                                    {inv.paid_at
                                                        ? new Date(inv.paid_at).toLocaleString("pt-BR", {
                                                              dateStyle: "short",
                                                              timeStyle: "short",
                                                          })
                                                        : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {variant === "pay" ? (
                        <button
                            type="button"
                            onClick={() => {
                                void loadBilling({ silent: true });
                            }}
                            className="text-xs font-semibold text-violet-600 hover:text-violet-700 lg:col-start-2 lg:row-start-2"
                        >
                            Atualizar dados
                        </button>
                    ) : (
                    <button
                        type="button"
                        onClick={() => {
                            void loadBilling();
                        }}
                        className="text-xs font-semibold text-violet-600 hover:text-violet-700"
                    >
                        Atualizar dados
                    </button>
                    )}
                </div>
            ) : null}

            {showReactivateHint ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <strong>Assinatura desativada por inatividade?</strong>{" "}
                    <Link
                        href="/plano/reativar"
                        className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-100"
                    >
                        Reative aqui
                    </Link>{" "}
                    para ganhar um novo período de teste.
                </div>
            ) : null}
        </div>
    );
}
