"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Pencil, RefreshCcw, Save, X } from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import { toast } from "sonner";
import type {
    UiSubscriptionRow,
    UiPlan,
    UiNeverPaidTenant,
    UiPlanPromotionAdmin,
} from "@/lib/billing/contracts/ui";
import type { PagarmeSubStatus, PagarmeInvoiceStatus } from "@/lib/billing/contracts/status";
import {
    brlInputToCents,
    centsToBrlInput,
    formatBrlFromCents,
    percentHundredthsToInput,
    percentInputToHundredths,
} from "@/lib/billing/moneyDisplay";
import { computeYearlyPriceCents } from "@/lib/billing/yearlyFromDiscount";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type SubRow = UiSubscriptionRow;

type PromoFormState = {
    plan_id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    duration_months: string;
    adjustment_mode: "fixed_brl" | "percent";
    discount_display: string;
};

const EMPTY_PROMO_FORM: PromoFormState = {
    plan_id: "",
    name: "",
    starts_at: "",
    ends_at: "",
    duration_months: "3",
    adjustment_mode: "percent",
    discount_display: "50,00",
};

/** ISO → valor de `<input type="datetime-local">` (fuso local). */
function toDatetimeLocalValue(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PromoAdminPanel({
    plans,
    isSuperadmin,
}: {
    plans: Array<{ id: string; key: string; name: string }>;
    isSuperadmin: boolean;
}) {
    const queryClient = useQueryClient();
    const { data } = useQuery({
        queryKey: ["platform", "billing", "promotions"],
        queryFn: () => platformApi.listPromotions(),
        staleTime: 30_000,
        enabled: isSuperadmin,
    });
    const [form, setForm] = useState<PromoFormState>(EMPTY_PROMO_FORM);
    const [editingId, setEditingId] = useState<string | null>(null);

    function buildPayload() {
        const value =
            form.adjustment_mode === "percent"
                ? percentInputToHundredths(form.discount_display)
                : brlInputToCents(form.discount_display);
        if (value == null) throw new Error("Informe o desconto (R$ ou %)");
        if (!form.starts_at || !form.ends_at) throw new Error("Informe início e fim da campanha");
        const duration = Number(form.duration_months);
        if (!Number.isInteger(duration) || duration < 1) {
            throw new Error("Meses de benefício inválidos");
        }
        return {
            plan_id: form.plan_id || plans[0]?.id || "",
            name: form.name,
            starts_at: new Date(form.starts_at).toISOString(),
            ends_at: new Date(form.ends_at).toISOString(),
            duration_months: duration,
            adjustment_kind: "discount" as const,
            adjustment_mode: form.adjustment_mode,
            adjustment_value: value,
        };
    }

    const save = useMutation({
        mutationFn: async () => {
            const payload = buildPayload();
            if (editingId) {
                return platformApi.updatePromotion(editingId, payload);
            }
            return platformApi.upsertPromotion({ ...payload, active: true });
        },
        onSuccess: () => {
            toast.success(editingId ? "Promo atualizada" : "Promo criada");
            setEditingId(null);
            setForm({ ...EMPTY_PROMO_FORM, plan_id: plans[0]?.id ?? "" });
            queryClient.invalidateQueries({ queryKey: ["platform", "billing", "promotions"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const toggle = useMutation({
        mutationFn: ({ id, active }: { id: string; active: boolean }) =>
            platformApi.setPromotionActive(id, active),
        onSuccess: (_d, v) => {
            toast.success(v.active ? "Promo ligada" : "Promo desligada");
            queryClient.invalidateQueries({ queryKey: ["platform", "billing", "promotions"] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    function startEdit(p: UiPlanPromotionAdmin) {
        const mode = p.adjustment_mode === "fixed_brl" ? "fixed_brl" : "percent";
        setEditingId(p.id);
        setForm({
            plan_id: p.plan_id,
            name: p.name ?? "",
            starts_at: toDatetimeLocalValue(p.starts_at),
            ends_at: toDatetimeLocalValue(p.ends_at),
            duration_months: String(p.duration_months),
            adjustment_mode: mode,
            discount_display:
                mode === "percent"
                    ? percentHundredthsToInput(p.adjustment_value)
                    : centsToBrlInput(p.adjustment_value),
        });
    }

    function cancelEdit() {
        setEditingId(null);
        setForm({ ...EMPTY_PROMO_FORM, plan_id: plans[0]?.id ?? "" });
    }

    if (!isSuperadmin) return null;

    const promotions = (data?.promotions ?? []) as UiPlanPromotionAdmin[];
    const inputCls =
        "rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950";

    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Promoções (só adesão mensal)
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
                Aparece em /signup como “De R$ … por R$ …”. Desligar corta novas adesões; quem já
                aderiu mantém os meses restantes. Anual sem promo.
            </p>
            {editingId && (
                <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Editando campanha — altere os campos e salve, ou cancele.
                </p>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Plano
                    <Select
                        value={form.plan_id || plans[0]?.id || undefined}
                        onValueChange={(v) => setForm((f) => ({ ...f, plan_id: v }))}
                    >
                        <SelectTrigger className={inputCls}>
                            <SelectValue placeholder="Plano" />
                        </SelectTrigger>
                        <SelectContent>
                            {plans.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Nome da campanha
                    <input
                        placeholder="Ex.: Lançamento Q3"
                        className={inputCls}
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Meses de benefício
                    <input
                        className={inputCls}
                        value={form.duration_months}
                        onChange={(e) => setForm((f) => ({ ...f, duration_months: e.target.value }))}
                    />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Início
                    <input
                        type="datetime-local"
                        className={inputCls}
                        value={form.starts_at}
                        onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Fim
                    <input
                        type="datetime-local"
                        className={inputCls}
                        value={form.ends_at}
                        onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                    />
                </label>
                <div className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                    Desconto
                    <div className="flex gap-1">
                        <Select
                            value={form.adjustment_mode}
                            onValueChange={(v) => {
                                const mode = v as "fixed_brl" | "percent";
                                setForm((f) => ({
                                    ...f,
                                    adjustment_mode: mode,
                                    discount_display: "0,00",
                                }));
                            }}
                        >
                            <SelectTrigger className={`${inputCls} w-auto`}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="percent">%</SelectItem>
                                <SelectItem value="fixed_brl">R$</SelectItem>
                            </SelectContent>
                        </Select>
                        <input
                            className={`${inputCls} flex-1`}
                            placeholder={
                                form.adjustment_mode === "percent" ? "% 00,00" : "R$ 00,00"
                            }
                            value={form.discount_display}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, discount_display: e.target.value }))
                            }
                        />
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => save.mutate()}
                    className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                    <Save className="h-3 w-3" />
                    {editingId ? "Salvar alterações" : "Criar promo"}
                </button>
                {editingId && (
                    <button
                        type="button"
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 rounded border border-zinc-200 px-3 py-1.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                    >
                        <X className="h-3 w-3" />
                        Cancelar
                    </button>
                )}
            </div>
            {promotions.length > 0 && (
                <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {promotions.slice(0, 12).map((p) => {
                        const discLabel =
                            p.adjustment_mode === "percent"
                                ? `% ${percentHundredthsToInput(p.adjustment_value)}`
                                : formatBrlFromCents(p.adjustment_value);
                        const isRowEditing = editingId === p.id;
                        return (
                            <li
                                key={p.id}
                                className={`flex flex-wrap items-center justify-between gap-2 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 ${
                                    isRowEditing ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                                }`}
                            >
                                <span>
                                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                        {(p.plans?.name ?? p.plans?.key) || "plano"}
                                    </span>
                                    {" · "}
                                    {p.name || "(sem nome)"}
                                    {" · desconto "}
                                    {discLabel}
                                    {" · "}
                                    {p.duration_months} meses
                                </span>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        title="Editar"
                                        onClick={() => startEdit(p)}
                                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                    >
                                        <Pencil className="h-3 w-3" />
                                        Editar
                                    </button>
                                    <label className="flex items-center gap-2 text-[10px] font-medium text-zinc-500">
                                        <span>{p.active ? "Ligada" : "Desligada"}</span>
                                        <Switch
                                            checked={p.active}
                                            disabled={toggle.isPending}
                                            onCheckedChange={(checked) =>
                                                toggle.mutate({ id: p.id, active: checked })
                                            }
                                            aria-label={
                                                p.active ? "Desligar promo" : "Ligar promo"
                                            }
                                        />
                                    </label>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/**
 * Badge visual do status de pagamento.
 * Cores semânticas: verde (pago), amarelo (trial/pending_payment), vermelho (overdue/blocked/cancelled), cinza (pending_setup).
 */
function PaymentStatusBadge({ status }: { status: PagarmeSubStatus }) {
    const config: Record<PagarmeSubStatus, { label: string; cls: string }> = {
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

function InvoiceStatusBadge({ status }: { status: PagarmeInvoiceStatus }) {
    const config: Record<PagarmeInvoiceStatus, { label: string; cls: string }> = {
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
    const [priceEdits, setPriceEdits] = useState<
        Record<
            string,
            {
                price_display?: string;
                yearly_mode?: "percent" | "fixed_brl";
                yearly_discount_display?: string;
                included_seats?: string;
                seat_extra_display?: string;
            }
        >
    >({});
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
        staleTime: 30_000,
    });

    const savePlanPrice = useMutation({
        mutationFn: ({
            id,
            body,
        }: {
            id: string;
            body: {
                price_cents?: number;
                included_seats?: number;
                seat_extra_cents?: number | null;
                yearly_discount_mode?: "percent" | "fixed_brl";
                yearly_discount_value?: number;
            };
        }) => platformApi.updatePlanPricing(id, body),
        onSuccess: () => {
            toast.success("Preço do plano atualizado");
            setPriceEdits({});
            queryClient.invalidateQueries({ queryKey: ["platform", "plans"] });
        },
        onError: (e: Error) => toast.error(e.message),
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
                    Preços dos planos (lista)
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                    Mensal e seats em R$. Anual = mensal × 12 menos desconto (% ou R$) — não é promo.
                    Default sugerido: −20%.
                </p>
                {!isSuperadmin ? (
                    <p className="mt-2 text-xs text-amber-700">Apenas superadmin edita preços.</p>
                ) : (
                    <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                            <thead className="text-zinc-500">
                                <tr>
                                    <th className="py-1 pr-3">Plano</th>
                                    <th className="py-1 pr-3">Mensal</th>
                                    <th className="py-1 pr-3">Desconto anual</th>
                                    <th className="py-1 pr-3">Anual calc.</th>
                                    <th className="py-1 pr-3">Seats</th>
                                    <th className="py-1 pr-3">Seat extra</th>
                                    <th className="py-1"> </th>
                                </tr>
                            </thead>
                            <tbody>
                                {(
                                    (plansData?.plans ?? []) as Array<{
                                        id: string;
                                        key: string;
                                        name: string;
                                        price_cents: number;
                                        price_year_cents: number | null;
                                        yearly_discount_mode?: "percent" | "fixed_brl";
                                        yearly_discount_value?: number;
                                        included_seats: number | null;
                                        seat_extra_cents: number | null;
                                    }>
                                ).map((p) => {
                                    const edit = priceEdits[p.id] ?? {};
                                    const mode =
                                        edit.yearly_mode ??
                                        p.yearly_discount_mode ??
                                        "percent";
                                    const monthDisp =
                                        edit.price_display ?? centsToBrlInput(p.price_cents);
                                    const discDisp =
                                        edit.yearly_discount_display ??
                                        (mode === "percent"
                                            ? percentHundredthsToInput(
                                                  p.yearly_discount_value ?? 2000
                                              )
                                            : centsToBrlInput(p.yearly_discount_value ?? 0));
                                    const seats =
                                        edit.included_seats ?? String(p.included_seats ?? 1);
                                    const seatX =
                                        edit.seat_extra_display ??
                                        (p.seat_extra_cents == null
                                            ? ""
                                            : centsToBrlInput(p.seat_extra_cents));
                                    const monthCents =
                                        brlInputToCents(monthDisp) ?? p.price_cents;
                                    const discVal =
                                        mode === "percent"
                                            ? (percentInputToHundredths(discDisp) ?? 2000)
                                            : (brlInputToCents(discDisp) ?? 0);
                                    const yearPreview = computeYearlyPriceCents(
                                        monthCents,
                                        mode,
                                        discVal
                                    );
                                    const inputCls =
                                        "w-full min-w-[5.5rem] rounded border border-zinc-200 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950";
                                    return (
                                        <tr
                                            key={p.id}
                                            className="border-t border-zinc-100 dark:border-zinc-800"
                                        >
                                            <td className="py-2 pr-3 font-medium">{p.name}</td>
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] text-zinc-400">
                                                        R$
                                                    </span>
                                                    <input
                                                        className={inputCls}
                                                        placeholder="00,00"
                                                        value={monthDisp}
                                                        onChange={(e) =>
                                                            setPriceEdits((prev) => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    price_display: e.target.value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-1">
                                                    <Select
                                                        value={mode}
                                                        onValueChange={(v) => {
                                                            const m = v as "percent" | "fixed_brl";
                                                            setPriceEdits((prev) => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    yearly_mode: m,
                                                                    yearly_discount_display:
                                                                        m === "percent"
                                                                            ? "20,00"
                                                                            : "0,00",
                                                                },
                                                            }));
                                                        }}
                                                    >
                                                        <SelectTrigger className="h-7 w-auto px-1 text-[10px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="percent">%</SelectItem>
                                                            <SelectItem value="fixed_brl">R$</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <input
                                                        className={inputCls}
                                                        placeholder={
                                                            mode === "percent" ? "00,00" : "00,00"
                                                        }
                                                        value={discDisp}
                                                        onChange={(e) =>
                                                            setPriceEdits((prev) => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    yearly_discount_display:
                                                                        e.target.value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-2 pr-3 tabular-nums text-zinc-600 dark:text-zinc-300">
                                                {formatBrlFromCents(yearPreview)}
                                            </td>
                                            <td className="py-2 pr-3">
                                                <input
                                                    className="w-14 rounded border border-zinc-200 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                                                    value={seats}
                                                    onChange={(e) =>
                                                        setPriceEdits((prev) => ({
                                                            ...prev,
                                                            [p.id]: {
                                                                ...prev[p.id],
                                                                included_seats: e.target.value,
                                                            },
                                                        }))
                                                    }
                                                />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] text-zinc-400">
                                                        R$
                                                    </span>
                                                    <input
                                                        className={inputCls}
                                                        placeholder="00,00"
                                                        value={seatX}
                                                        onChange={(e) =>
                                                            setPriceEdits((prev) => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    seat_extra_display:
                                                                        e.target.value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-2">
                                                <button
                                                    type="button"
                                                    disabled={savePlanPrice.isPending}
                                                    onClick={() => {
                                                        const price = brlInputToCents(monthDisp);
                                                        if (price == null) {
                                                            toast.error("Mensal inválido");
                                                            return;
                                                        }
                                                        const yVal =
                                                            mode === "percent"
                                                                ? percentInputToHundredths(
                                                                      discDisp
                                                                  )
                                                                : brlInputToCents(discDisp);
                                                        if (yVal == null) {
                                                            toast.error("Desconto anual inválido");
                                                            return;
                                                        }
                                                        const body: {
                                                            price_cents: number;
                                                            yearly_discount_mode:
                                                                | "percent"
                                                                | "fixed_brl";
                                                            yearly_discount_value: number;
                                                            included_seats?: number;
                                                            seat_extra_cents?: number | null;
                                                        } = {
                                                            price_cents: price,
                                                            yearly_discount_mode: mode,
                                                            yearly_discount_value: yVal,
                                                        };
                                                        if (seats !== "")
                                                            body.included_seats = Number(seats);
                                                        if (seatX.trim() === "")
                                                            body.seat_extra_cents = null;
                                                        else {
                                                            const sx = brlInputToCents(seatX);
                                                            if (sx == null) {
                                                                toast.error("Seat extra inválido");
                                                                return;
                                                            }
                                                            body.seat_extra_cents = sx;
                                                        }
                                                        savePlanPrice.mutate({ id: p.id, body });
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                                                >
                                                    <Save className="h-3 w-3" />
                                                    Salvar
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <PromoAdminPanel
                plans={
                    (plansData?.plans ?? []) as Array<{ id: string; key: string; name: string }>
                }
                isSuperadmin={isSuperadmin}
            />

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
                                    E-mail
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Plano
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Status
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
                                    planEdits[s.id] ?? s.plan?.key ?? plans[0]?.key ?? "";
                                const isCompanyActive = s.company?.is_active ?? true;
                                return (
                                    <tr key={s.id}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                                {s.company?.name ?? "—"}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">
                                                {s.company?.slug ?? s.id.slice(0, 8)}
                                                {!isCompanyActive && (
                                                    <span className="ml-1 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                                        Suspensa
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                                            {s.company?.email ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-xs">{s.plan?.name ?? "—"}</td>
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
                                                <Select
                                                    value={selected}
                                                    onValueChange={(v) =>
                                                        setPlanEdits((m) => ({
                                                            ...m,
                                                            [s.id]: v,
                                                        }))
                                                    }
                                                >
                                                    <SelectTrigger className="h-7 w-auto min-w-[8rem] px-2 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {plans.map((p) => (
                                                            <SelectItem key={p.id} value={p.key}>
                                                                {p.name} ({p.key})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
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
                                        colSpan={8}
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
                            Trial cortesia (1–30d) só para superadmin. Checkout disponível para billing write.
                        </p>
                    )}
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    Empresa
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-zinc-400">
                                    E-mail
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
                                                {t.companyId.slice(0, 8)}
                                                {!t.isActive && (
                                                    <span className="ml-1 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                                        Inativa
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                                            {t.email ?? "—"}
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
                                                        <Select
                                                            value={courtesyPlan}
                                                            onValueChange={(v) =>
                                                                setCourtesyPlanByCompany((m) => ({
                                                                    ...m,
                                                                    [t.companyId]: v as
                                                                        | "essencial"
                                                                        | "pro"
                                                                        | "market",
                                                                }))
                                                            }
                                                        >
                                                            <SelectTrigger
                                                                className="h-7 w-auto px-1 text-xs"
                                                                title="Plano do trial"
                                                                aria-label="Plano do trial"
                                                            >
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="essencial">
                                                                    Essencial
                                                                </SelectItem>
                                                                <SelectItem value="pro">Pro</SelectItem>
                                                                <SelectItem value="market">
                                                                    Market
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
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
