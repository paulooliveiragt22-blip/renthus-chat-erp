"use client";

import React, { useCallback, useEffect, useId, useState } from "react";
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

function Field({
    label,
    value,
    onChange,
    placeholder = "",
    type = "text",
    hint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    hint?: string;
}) {
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {label}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {hint ? <p className="text-[11px] text-zinc-400">{hint}</p> : null}
        </div>
    );
}

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
    const { currentCompanyId: companyId } = useWorkspace();
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

    const loadCompany = useCallback(async () => {
        if (!companyId) return;
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

    const loadBilling = useCallback(async () => {
        if (!companyId) return;
        setBillingLoading(true);
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
        } catch {
            setBillingErr("Erro de rede ao carregar cobrança.");
            setBillingData(null);
        } finally {
            setBillingLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        void loadCompany();
    }, [loadCompany]);

    useEffect(() => {
        void loadBilling();
    }, [loadBilling]);

    // Gate /plano/pagar: após PIX, espera webhook liberar e manda para /ativar (não fica no ERP).
    useEffect(() => {
        if (variant !== "pay") return;
        const st = billingData?.pagarme_subscription?.status;
        if (st === "active" || st === "trial") {
            window.location.assign("/ativar");
            return;
        }
        if (!pixLiveCode && !pixLiveUrl && !billingData?.pending_invoice?.pix_qr_code) return;
        const id = window.setInterval(() => {
            void loadBilling();
        }, 5000);
        return () => window.clearInterval(id);
    }, [
        variant,
        billingData?.pagarme_subscription?.status,
        billingData?.pending_invoice?.pix_qr_code,
        pixLiveCode,
        pixLiveUrl,
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
            await loadBilling();
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
        const { exp, num, cvv, holder, addrCep } = validated;

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
                    holder_document: cnpj.replaceAll(/\D/g, "") || undefined,
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

    const loading = companyLoading || billingLoading;

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

            {!loading && billingErr ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                    {billingErr}
                </div>
            ) : null}

            {!loading && billingData ? (
                <div className="flex flex-col gap-6">
                    <div className={variant === "pay" ? "order-2" : undefined}>
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
                                    : st === "pending_payment"
                                      ? "Aguardando 1º pagamento"
                                      : st === "pending_setup"
                                        ? "Ativação pendente"
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

                    <div className={variant === "pay" ? "order-1" : undefined}>
                    {(() => {
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
                        const sp = billingData.setup_prices_brl ?? {};
                        const mp = billingData.monthly_prices_brl ?? {};

                        const pendSetup = billingData.pending_setup_payment;
                        const pendInv = billingData.pending_invoice;
                        const pendRecord =
                            st === "pending_payment"
                                ? (pendInv ?? pendSetup)
                                : isFirstPayment
                                  ? (pendSetup ?? pendInv)
                                  : pendInv;

                        const priceFallback = pk === "market" ? 397 : pk === "pro" ? 279 : 197;

                        let refAmount: number;
                        if (pendRecord) {
                            refAmount = Number(pendRecord.amount);
                        } else if (isFirstPayment) {
                            refAmount =
                                st === "pending_payment"
                                    ? ((mp as Record<string, number | undefined>)[pk] ?? priceFallback)
                                    : ((sp as Record<string, number | undefined>)[pk] ?? priceFallback);
                        } else {
                            refAmount =
                                (mp as Record<string, number | undefined>)[pk] ?? priceFallback;
                        }

                        const fromPendPix =
                            typeof (pendRecord as { pix_qr_code?: string | null } | null | undefined)
                                ?.pix_qr_code === "string"
                                ? String(
                                      (pendRecord as { pix_qr_code: string }).pix_qr_code
                                  ).trim()
                                : "";
                        const fromInvPix = (billingData.pending_invoice?.pix_qr_code ?? "").trim();
                        const pixUrl =
                            pixLiveUrl ??
                            (pendRecord?.pagarme_payment_url?.startsWith("http")
                                ? pendRecord.pagarme_payment_url
                                : null);
                        const pixCode = (pixLiveCode ?? "").trim() || fromPendPix || fromInvPix;

                        const showPay =
                            st === "trial" ||
                            st === "pending_setup" ||
                            st === "pending_payment" ||
                            st === "active" ||
                            st === "overdue" ||
                            st === "blocked";

                        if (!showPay) return null;

                        let pixButtonLabel = "Gerar código PIX";
                        if (pixLoading) pixButtonLabel = "Gerando…";
                        else if (pixUrl || pixCode) pixButtonLabel = "Gerar novo / atualizar PIX";

                        const paymentTitle =
                            variant === "pay"
                                ? "Concluir pagamento"
                                : isFirstPayment
                                  ? "Ativar plano RenthusAgent"
                                  : "Pagar mensalidade RenthusAgent";

                        const paymentDesc =
                            variant === "pay"
                                ? "Escolha PIX ou cartão de crédito para liberar seu acesso."
                                : isFirstPayment
                                  ? "Taxa de ativação única — após o pagamento as mensalidades são cobradas a cada 30 dias."
                                  : "Mensalidade recorrente. Próximo vencimento em 30 dias após o pagamento.";

                        return (
                            <div className="rounded-2xl border-2 border-violet-300/70 bg-gradient-to-br from-violet-50 via-white to-zinc-50 p-5 shadow-sm dark:border-violet-800 dark:from-violet-950/30 dark:via-zinc-900 dark:to-zinc-950">
                                {st === "blocked" ? (
                                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                                        Acesso suspenso. Pague abaixo: cartão aprovado libera na hora; PIX libera
                                        quando o banco confirmar.
                                    </div>
                                ) : null}
                                {st === "pending_payment" ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                        Pagamento inicial pendente. Escolha PIX ou cartão para começar a usar o
                                        RenthusAgent.
                                    </div>
                                ) : null}
                                {st === "overdue" ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                        Mensalidade em aberto. Escolha PIX ou cartão.
                                    </div>
                                ) : null}
                                {st === "pending_setup" ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                        Taxa de ativação em aberto. Escolha PIX ou cartão para ativar.
                                    </div>
                                ) : null}
                                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                                    {paymentTitle}
                                </h3>
                                <p className="mt-0.5 text-xs text-zinc-500">{paymentDesc}</p>
                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                                    Valor:{" "}
                                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                        {refAmount.toLocaleString("pt-BR", {
                                            style: "currency",
                                            currency: "BRL",
                                        })}
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
                                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                                        {billingSuccessMsg}
                                    </div>
                                ) : null}

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setRenthusPayMode("pix")}
                                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                            renthusPayMode === "pix"
                                                ? "bg-violet-600 text-white"
                                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                                        }`}
                                    >
                                        PIX
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRenthusPayMode("card")}
                                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                            renthusPayMode === "card"
                                                ? "bg-violet-600 text-white"
                                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                                        }`}
                                    >
                                        Cartão de crédito
                                    </button>
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
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                try {
                                                                    await navigator.clipboard.writeText(pixCode);
                                                                    setPixCopied(true);
                                                                    setTimeout(() => setPixCopied(false), 2000);
                                                                } catch {
                                                                    setBillingErr("Não foi possível copiar.");
                                                                }
                                                            }}
                                                            className="mt-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900"
                                                        >
                                                            {pixCopied ? "Copiado!" : "Copiar PIX"}
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void openRenthusPix();
                                            }}
                                            disabled={pixLoading}
                                            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                                        >
                                            {pixButtonLabel}
                                        </button>
                                        <p className="text-xs text-zinc-500">
                                            O plano é liberado automaticamente quando o pagamento for confirmado
                                            pelo Pagar.me.
                                        </p>
                                    </div>
                                ) : null}

                                {renthusPayMode === "card" ? (
                                    <div className="mt-4 space-y-3">
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
                                                onChange={(v) => setRenthusCard((c) => ({ ...c, number: v }))}
                                                placeholder="0000 0000 0000 0000"
                                            />
                                            <Field
                                                label="Validade (MM/AA)"
                                                value={renthusCard.exp}
                                                onChange={(v) => setRenthusCard((c) => ({ ...c, exp: v }))}
                                                placeholder="08/28"
                                            />
                                            <Field
                                                label="CVV"
                                                value={renthusCard.cvv}
                                                onChange={(v) => setRenthusCard((c) => ({ ...c, cvv: v }))}
                                                placeholder="123"
                                                type="password"
                                            />
                                        </div>
                                        <div>
                                            <label
                                                htmlFor="renthus-installments"
                                                className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                                            >
                                                Parcelas (valor da mensalidade)
                                            </label>
                                            <select
                                                id="renthus-installments"
                                                value={renthusInstallments}
                                                onChange={(e) => setRenthusInstallments(Number(e.target.value))}
                                                className="mt-1 w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                            >
                                                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                                                    <option key={n} value={n}>
                                                        {n}x
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                                Endereço de cobrança
                                            </p>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="flex flex-col gap-1">
                                                    <label
                                                        htmlFor="renthus-card-cep"
                                                        className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                                                    >
                                                        CEP
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            id="renthus-card-cep"
                                                            type="text"
                                                            value={cardAddr.cep}
                                                            onChange={(e) =>
                                                                setCardAddr((a) => ({ ...a, cep: e.target.value }))
                                                            }
                                                            onBlur={(e) => {
                                                                void fetchViaCep(e.target.value);
                                                            }}
                                                            placeholder="00000-000"
                                                            maxLength={9}
                                                            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                                                        onChange={(v) =>
                                                            setCardAddr((a) => ({ ...a, endereco: v }))
                                                        }
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
                                                        setCardAddr((a) => ({
                                                            ...a,
                                                            uf: v.toUpperCase().slice(0, 2),
                                                        }))
                                                    }
                                                    placeholder="SP"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void payRenthusCard();
                                            }}
                                            disabled={cardPayLoading}
                                            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                                        >
                                            {cardPayLoading ? "Processando…" : "Pagar com cartão"}
                                        </button>
                                        <p className="text-xs text-zinc-500">
                                            Aprovado na hora = plano liberado imediatamente. Em análise = liberamos
                                            quando o banco confirmar (webhook).
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })()}
                    </div>

                    {variant === "full" && billingData.pagarme_subscription?.status === "trial" ? (
                        <div>
                            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
                                Escolha do plano (durante o teste)
                            </p>
                            <div className="grid gap-3 sm:grid-cols-3">
                                {(
                                    [
                                        {
                                            key: "essencial" as const,
                                            name: "Essencial",
                                            blurb: "WhatsApp + cardápio + IA",
                                        },
                                        {
                                            key: "pro" as const,
                                            name: "Pro",
                                            blurb: "ERP + impressão + IA",
                                            popular: true,
                                        },
                                        {
                                            key: "market" as const,
                                            name: "Market",
                                            blurb: "Pro + iFood/Aiqfome + omni",
                                        },
                                    ] as const
                                ).map((p) => {
                                    const cur = String(billingData.pagarme_subscription?.plan ?? "");
                                    const active =
                                        cur === p.key ||
                                        (p.key === "essencial" && (cur === "bot" || cur === "starter")) ||
                                        (p.key === "pro" && cur === "complete");
                                    const mp = billingData.monthly_prices_brl ?? {};
                                    const price =
                                        (mp as Record<string, number>)[p.key] ??
                                        (p.key === "essencial" ? 197 : p.key === "pro" ? 279 : 397);
                                    return (
                                        <div
                                            key={p.key}
                                            className={`rounded-xl border-2 p-4 ${
                                                active
                                                    ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
                                                    : "border-zinc-200 dark:border-zinc-700"
                                            }`}
                                        >
                                            {"popular" in p && p.popular ? (
                                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-600">
                                                    Mais popular
                                                </p>
                                            ) : null}
                                            <p className="font-bold text-zinc-900 dark:text-zinc-100">{p.name}</p>
                                            <p className="mt-0.5 text-xs text-zinc-500">{p.blurb}</p>
                                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                                                {price.toLocaleString("pt-BR", {
                                                    style: "currency",
                                                    currency: "BRL",
                                                })}
                                                /mês
                                            </p>
                                            <button
                                                type="button"
                                                disabled={planSaving || active}
                                                onClick={() => {
                                                    void changeRenthusPlan(p.key);
                                                }}
                                                className="mt-3 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                                            >
                                                {active ? "Plano atual" : "Usar este plano"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {variant === "full"
                        ? (() => {
                              const cur = String(billingData.pagarme_subscription?.plan ?? "");
                              const st = billingData.pagarme_subscription?.status;
                              const paid = st === "active" || st === "overdue";
                              if (!paid) return null;
                              const isEssencial =
                                  cur === "essencial" || cur === "bot" || cur === "starter";
                              const isPro = cur === "pro" || cur === "complete";
                              const isMarket = cur === "market";
                              const mp = billingData.monthly_prices_brl ?? {};
                              if (isMarket) {
                                  return (
                                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                          Você já está no plano Market (máximo atual).
                                      </p>
                                  );
                              }
                              return (
                                  <div className="space-y-3">
                                      {isEssencial ? (
                                          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                                              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                                  Upgrade para Pro
                                              </p>
                                              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                                  ERP completo + impressão automática (
                                                  {(
                                                      (mp as Record<string, number>).pro ?? 279
                                                  ).toLocaleString("pt-BR", {
                                                      style: "currency",
                                                      currency: "BRL",
                                                  })}
                                                  /mês).
                                              </p>
                                              <button
                                                  type="button"
                                                  disabled={planSaving}
                                                  onClick={() => {
                                                      void changeRenthusPlan("pro");
                                                  }}
                                                  className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                              >
                                                  {planSaving ? "Salvando…" : "Ir para Pro"}
                                              </button>
                                          </div>
                                      ) : null}
                                      {isEssencial || isPro ? (
                                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                                              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                                  Upgrade para Market
                                              </p>
                                              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                                  iFood + Aiqfome + Instagram/Messenger + mesa (
                                                  {(
                                                      (mp as Record<string, number>).market ?? 397
                                                  ).toLocaleString("pt-BR", {
                                                      style: "currency",
                                                      currency: "BRL",
                                                  })}
                                                  /mês).
                                              </p>
                                              <button
                                                  type="button"
                                                  disabled={planSaving}
                                                  onClick={() => {
                                                      void changeRenthusPlan("market");
                                                  }}
                                                  className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                                              >
                                                  {planSaving ? "Salvando…" : "Ir para Market"}
                                              </button>
                                          </div>
                                      ) : null}
                                  </div>
                              );
                          })()
                        : null}

                    {variant === "full" ? (
                        <SectionTitle
                            icon={CreditCard}
                            title="Formas de pagamento (cobrança RenthusAgent)"
                            desc="Como você paga a mensalidade da plataforma — não confunde com formas aceitas no delivery"
                        />
                    ) : null}

                    {variant === "full" ? (
                        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">PIX e cartão</p>
                            <p className="mt-1 text-xs text-zinc-500">
                                Use o bloco de pagamento acima: PIX (QR e copia e cola) ou cartão tokenizado no
                                Pagar.me. Confirmação do pagamento libera o plano automaticamente (webhook ou
                                aprovação imediata).
                            </p>
                        </div>
                    ) : null}

                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                            Cartões salvos no Pagar.me
                        </p>
                        {!billingData.saved_cards?.length ? (
                            <p className="mt-2 text-xs text-zinc-500">
                                Nenhum cartão cadastrado ainda. Cartões aparecem aqui após pagamentos com cartão
                                pelo gateway (quando o cliente existir no Pagar.me).
                            </p>
                        ) : null}
                        {billingData.saved_cards?.length ? (
                            <ul className="mt-3 space-y-2">
                                {billingData.saved_cards.map((c) => (
                                    <li
                                        key={c.id || c.last_four}
                                        className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/80"
                                    >
                                        <span>
                                            <span className="font-medium capitalize">{c.brand || "Cartão"}</span>
                                            {c.last_four ? ` •••• ${c.last_four}` : ""}
                                            {c.exp ? ` · validade ${c.exp}` : ""}
                                        </span>
                                        <span className="text-xs text-zinc-400">{c.status || "—"}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    {billingData.invoice_history?.length ? (
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
                                                <td className="px-3 py-2 capitalize">{inv.status}</td>
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

                    <button
                        type="button"
                        onClick={() => {
                            void loadBilling();
                        }}
                        className="text-xs font-semibold text-violet-600 hover:text-violet-700"
                    >
                        Atualizar dados
                    </button>
                </div>
            ) : null}
        </div>
    );
}
