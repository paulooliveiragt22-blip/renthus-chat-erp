"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, RefreshCcw, Save } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import { toast } from "sonner";

type SubRow = {
    id: string;
    status: string;
    plan_key: string | null;
    is_active?: boolean;
    trial_ends_at: string | null;
    last_paid_at: string | null;
    next_billing_at: string | null;
    allow_overage: boolean;
    companies?: { id: string; name: string; slug?: string; is_active?: boolean } | null;
    plans?: { id: string; key: string; name: string; price_cents: number } | null;
    last_invoice?: {
        id: string;
        amount: number;
        status: string;
        due_at: string;
        paid_at: string | null;
    } | null;
};

/**
 * Badge visual do status de pagamento.
 * Cores semânticas: verde (pago), amarelo (trial/pending_payment), vermelho (overdue/blocked/cancelled), cinza (pending_setup).
 */
function PaymentStatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; cls: string }> = {
        active: { label: "Pago", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
        trial: { label: "Trial", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
        overdue: { label: "Vencido", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
        blocked: { label: "Bloqueado", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
        cancelled: { label: "Cancelado", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
        pending_payment: { label: "Pgto pendente", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
        pending_setup: { label: "Setup pendente", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
        abandoned: { label: "Abandonado", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
    };
    const c = config[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" };
    return (
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>
            {c.label}
        </span>
    );
}

function InvoiceStatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; cls: string }> = {
        paid: { label: "Paga", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
        pending: { label: "Pendente", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
        failed: { label: "Falhou", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
        cancelled: { label: "Cancelada", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
    };
    const c = config[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-700" };
    return (
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>
            {c.label}
        </span>
    );
}

type BillingTab = "subscriptions" | "never_paid";

export default function PlatformBillingPage() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<BillingTab>("subscriptions");
    const [planEdits, setPlanEdits] = useState<Record<string, string>>({});
    const [trialDaysInput, setTrialDaysInput] = useState<string>("");
    const [courtesyDaysByCompany, setCourtesyDaysByCompany] = useState<Record<string, string>>({});
    const [courtesyPlanByCompany, setCourtesyPlanByCompany] = useState<
        Record<string, "essencial" | "pro" | "market">
    >({});

    const { data: meData } = useQuery({
        queryKey: ["platform", "me"],
        queryFn: () => platformApi.me(),
        staleTime: 60_000,
    });
    const isSuperadmin =
        (meData?.user as { role?: string } | undefined)?.role === "superadmin";

    const { data: settingsData, isLoading: settingsLoading } = useQuery({
        queryKey: ["platform", "billing", "settings"],
        queryFn: () => platformApi.billingSettings(),
        staleTime: 30_000,
    });

    const settings = settingsData?.settings;
    const trialDaysDisplay =
        trialDaysInput !== ""
            ? trialDaysInput
            : settings != null
              ? String(settings.default_trial_days)
              : "0";

    const saveSettings = useMutation({
        mutationFn: (days: number) => platformApi.updateBillingSettings(days),
        onSuccess: (res) => {
            toast.success("Política de trial atualizada");
            setTrialDaysInput(String(res.settings.default_trial_days));
            queryClient.invalidateQueries({ queryKey: ["platform", "billing", "settings"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["platform", "billing", "subscriptions"],
        queryFn: () => platformApi.billingSubscriptions(),
        staleTime: 30_000,
        enabled: tab === "subscriptions",
    });

    const {
        data: neverPaidData,
        isLoading: neverPaidLoading,
        error: neverPaidError,
        refetch: refetchNeverPaid,
        isFetching: neverPaidFetching,
    } = useQuery({
        queryKey: ["platform", "billing", "never_paid"],
        queryFn: () => platformApi.neverPaidTenants(0, 100),
        staleTime: 30_000,
        enabled: tab === "never_paid",
    });

    const { data: plansData } = useQuery({
        queryKey: ["platform", "plans"],
        queryFn: () => platformApi.plans(),
        staleTime: Infinity,
    });

    const plans = (plansData?.plans ?? []) as Array<{ id: string; key: string; name: string }>;
    const subscriptions = (data?.subscriptions ?? []) as SubRow[];
    const neverPaidTenants = neverPaidData?.tenants ?? [];

    const changePlan = useMutation({
        mutationFn: ({ id, plan_key }: { id: string; plan_key: string }) =>
            platformApi.changePlan(id, plan_key, "ajuste via /platform/billing"),
        onSuccess: () => {
            toast.success("Plano atualizado");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const toggleOverage = useMutation({
        mutationFn: ({ id, allow_overage }: { id: string; allow_overage: boolean }) =>
            platformApi.allowOverage(id, allow_overage, "ajuste via /platform/billing"),
        onSuccess: () => {
            toast.success("Overage atualizado");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const ensureCheckout = useMutation({
        mutationFn: (companyId: string) =>
            platformApi.ensureTenantCheckout(companyId),
        onSuccess: (res) => {
            if (res.has_pix) toast.success("Checkout gerado com PIX");
            else if (res.invoice_ready) toast.success("Fatura pending criada (sem PIX ainda)");
            else toast.message("Nenhuma fatura gerada — verifique Pagar.me");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing", "never_paid"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const courtesyTrial = useMutation({
        mutationFn: ({
            companyId,
            days,
            planKey,
        }: {
            companyId: string;
            days: number;
            planKey: "essencial" | "pro" | "market";
        }) =>
            platformApi.grantCourtesyTrial(
                companyId,
                days,
                planKey,
                "cortesia via /platform/billing"
            ),
        onSuccess: (res) => {
            const planLabel =
                res.plan_key === "market"
                    ? "Market"
                    : res.plan_key === "pro"
                      ? "Pro"
                      : "Essencial";
            toast.success(
                `Trial ${planLabel} até ${new Date(res.trial_ends_at).toLocaleDateString("pt-BR")}`
            );
            queryClient.invalidateQueries({ queryKey: ["platform", "billing", "never_paid"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const listFetching = tab === "never_paid" ? neverPaidFetching : isFetching;
    const listRefetch = tab === "never_paid" ? refetchNeverPaid : refetch;

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Billing</h1>
                    <p className="text-xs text-zinc-500">
                        {tab === "never_paid"
                            ? `Sem pagamento (${neverPaidData?.total ?? neverPaidTenants.length})`
                            : `Assinaturas cross-tenant (${subscriptions.length})`}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => listRefetch()}
                    disabled={listFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${listFetching ? "animate-spin" : ""}`} />
                    Atualizar
                </button>
            </div>

            <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900/80">
                <button
                    type="button"
                    onClick={() => setTab("subscriptions")}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        tab === "subscriptions"
                            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 hover:text-zinc-700"
                    }`}
                >
                    Assinaturas
                </button>
                <button
                    type="button"
                    onClick={() => setTab("never_paid")}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        tab === "never_paid"
                            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 hover:text-zinc-700"
                    }`}
                >
                    Sem pagamento
                </button>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Trial padrão (novos cadastros)
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                    0 = pay-to-start (pagamento antes de usar o app). Máximo 90 dias.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Dias de trial
                        <input
                            type="number"
                            min={0}
                            max={90}
                            value={trialDaysDisplay}
                            onChange={(e) => setTrialDaysInput(e.target.value)}
                            disabled={settingsLoading || saveSettings.isPending}
                            className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                    </label>
                    <button
                        type="button"
                        disabled={settingsLoading || saveSettings.isPending}
                        onClick={() => {
                            const n = Number(trialDaysDisplay);
                            if (!Number.isFinite(n) || n < 0 || n > 90) {
                                toast.error("Informe um número entre 0 e 90");
                                return;
                            }
                            saveSettings.mutate(n);
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                        {saveSettings.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Save className="h-3.5 w-3.5" />
                        )}
                        Salvar
                    </button>
                    {settings?.updated_at && (
                        <span className="text-[11px] text-zinc-400">
                            Atualizado{" "}
                            {new Date(settings.updated_at).toLocaleString("pt-BR")}
                        </span>
                    )}
                </div>
            </div>

            {tab === "subscriptions" && isLoading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                </div>
            )}

            {tab === "subscriptions" && error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {(error as Error).message}
                </div>
            )}

            {tab === "subscriptions" && !isLoading && !error && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Empresa
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Plano
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Status
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Pagamento
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Última fatura
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Próx. cobrança
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Overage
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Ações
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {subscriptions.map((s) => {
                                const selected =
                                    planEdits[s.id] ?? s.plans?.key ?? plans[0]?.key ?? "";
                                const isCompanyActive = s.companies?.is_active ?? s.is_active ?? true;
                                return (
                                    <tr key={s.id}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                                {s.companies?.name ?? "—"}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">
                                                {s.companies?.slug ?? s.id.slice(0, 8)}
                                                {!isCompanyActive && (
                                                    <span className="ml-1 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                                        Suspensa
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">{s.plans?.name ?? "—"}</td>
                                        <td className="px-3 py-2 text-xs">
                                            <PaymentStatusBadge status={s.status} />
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {s.last_invoice ? (
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="font-mono">
                                                        R$ {s.last_invoice.amount.toFixed(2)}
                                                    </span>
                                                    <InvoiceStatusBadge status={s.last_invoice.status} />
                                                </div>
                                            ) : (
                                                <span className="text-zinc-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                                            {s.next_billing_at
                                                ? new Date(s.next_billing_at).toLocaleDateString("pt-BR")
                                                : s.last_paid_at
                                                  ? <span className="text-emerald-600 dark:text-emerald-400">Pago</span>
                                                  : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {s.allow_overage ? "Sim" : "Não"}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <select
                                                    value={selected}
                                                    onChange={(e) =>
                                                        setPlanEdits((m) => ({
                                                            ...m,
                                                            [s.id]: e.target.value,
                                                        }))
                                                    }
                                                    className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                >
                                                    {plans.map((p) => (
                                                        <option key={p.id} value={p.key}>
                                                            {p.name} ({p.key})
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    disabled={changePlan.isPending}
                                                    onClick={() =>
                                                        changePlan.mutate({
                                                            id: s.id,
                                                            plan_key: selected,
                                                        })
                                                    }
                                                    className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                                >
                                                    Aplicar plano
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={toggleOverage.isPending}
                                                    onClick={() =>
                                                        toggleOverage.mutate({
                                                            id: s.id,
                                                            allow_overage: !s.allow_overage,
                                                        })
                                                    }
                                                    className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                                                >
                                                    {s.allow_overage
                                                        ? "Desligar overage"
                                                        : "Ligar overage"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {subscriptions.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-3 py-8 text-center text-xs text-zinc-400"
                                    >
                                        Nenhuma assinatura.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {tab === "never_paid" && neverPaidLoading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                </div>
            )}

            {tab === "never_paid" && neverPaidError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {(neverPaidError as Error).message}
                </div>
            )}

            {tab === "never_paid" && !neverPaidLoading && !neverPaidError && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    {!isSuperadmin && (
                        <p className="border-b border-zinc-100 px-3 py-2 text-[11px] text-amber-700 dark:border-zinc-800 dark:text-amber-400">
                            Trial cortesia (1–14d) só para superadmin. Checkout disponível para billing write.
                        </p>
                    )}
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Empresa
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Plano / status
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Fatura
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Ações
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {neverPaidTenants.map((t) => {
                                const courtesyInput =
                                    courtesyDaysByCompany[t.companyId] ?? "7";
                                const currentPlanRaw = String(t.plan ?? "").toLowerCase();
                                const initialPlan: "essencial" | "pro" | "market" =
                                    currentPlanRaw === "market" ||
                                    currentPlanRaw === "pro" ||
                                    currentPlanRaw === "essencial"
                                        ? (currentPlanRaw as "essencial" | "pro" | "market")
                                        : "essencial";
                                const courtesyPlan =
                                    courtesyPlanByCompany[t.companyId] ?? initialPlan;
                                return (
                                    <tr key={t.companyId}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                                {t.companyName}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">
                                                {t.email ?? "—"} · {t.companyId.slice(0, 8)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            <div>{t.plan}</div>
                                            <div className="text-zinc-400">{t.billingStatus}</div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {t.pendingInvoice ? (
                                                <>
                                                    <div>
                                                        {t.pendingInvoice.amount.toLocaleString(
                                                            "pt-BR",
                                                            {
                                                                style: "currency",
                                                                currency: "BRL",
                                                            }
                                                        )}
                                                    </div>
                                                    <div className="text-zinc-400">
                                                        {t.pendingInvoice.hasPix
                                                            ? "PIX ok"
                                                            : "Sem EMV"}
                                                    </div>
                                                </>
                                            ) : (
                                                <span className="text-zinc-400">Sem pending</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    disabled={ensureCheckout.isPending}
                                                    onClick={() =>
                                                        ensureCheckout.mutate(t.companyId)
                                                    }
                                                    className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                                >
                                                    Gerar checkout
                                                </button>
                                                {isSuperadmin ? (
                                                    <>
                                                        <select
                                                            value={courtesyPlan}
                                                            onChange={(e) =>
                                                                setCourtesyPlanByCompany((m) => ({
                                                                    ...m,
                                                                    [t.companyId]: e.target
                                                                        .value as
                                                                        | "essencial"
                                                                        | "pro"
                                                                        | "market",
                                                                }))
                                                            }
                                                            className="rounded border border-zinc-200 bg-zinc-50 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                            title="Plano do trial"
                                                            aria-label="Plano do trial"
                                                        >
                                                            <option value="essencial">Essencial</option>
                                                            <option value="pro">Pro</option>
                                                            <option value="market">Market</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={30}
                                                            value={courtesyInput}
                                                            onChange={(e) =>
                                                                setCourtesyDaysByCompany((m) => ({
                                                                    ...m,
                                                                    [t.companyId]: e.target.value,
                                                                }))
                                                            }
                                                            className="w-12 rounded border border-zinc-200 bg-zinc-50 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                                                            title="Dias cortesia (1 a 30)"
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={courtesyTrial.isPending}
                                                            onClick={() => {
                                                                const d = Number(courtesyInput);
                                                                if (
                                                                    !Number.isFinite(d) ||
                                                                    d < 1 ||
                                                                    d > 30
                                                                ) {
                                                                    toast.error(
                                                                        "Cortesia: 1 a 30 dias"
                                                                    );
                                                                    return;
                                                                }
                                                                courtesyTrial.mutate({
                                                                    companyId: t.companyId,
                                                                    days: d,
                                                                    planKey: courtesyPlan,
                                                                });
                                                            }}
                                                            className="rounded border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
                                                        >
                                                            Trial cortesia
                                                        </button>
                                                    </>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {neverPaidTenants.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-3 py-8 text-center text-xs text-zinc-400"
                                    >
                                        Nenhuma empresa sem pagamento.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
