"use client";

import type { ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    Building2,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Plus,
    RefreshCcw,
} from "lucide-react";
import { platformApi } from "@/lib/platform/clientApi";
import PlatformCompaniesFiltersBar from "@/components/platform/PlatformCompaniesFiltersBar";
import {
    companiesFilterQueryString,
    parseCompaniesFilterFromSearchParams,
    PLATFORM_SUB_STATUS_LABELS,
    type PlatformCompaniesFilter,
    type PlatformSubStatus,
} from "@/lib/platform/companiesFilters";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const SUB_STYLES: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    trial: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    blocked: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    inactive: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function timeAgo(iso: string) {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR");
}

const EMPTY_FORM = {
    name: "",
    email: "",
    slug: "",
    cnpj: "",
    phone: "",
    cidade: "",
    plan_id: "",
};

const LIMIT = 50;

function NovaEmpresaModal({
    plans,
    onClose,
    onCreated,
}: {
    plans: Array<{ id: string; name: string; price_cents: number }>;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const [form, setForm] = useState({
        ...EMPTY_FORM,
        plan_id: plans[0]?.id ?? "",
    });
    const queryClient = useQueryClient();

    const create = useMutation({
        mutationFn: () => platformApi.createCompany(form).then((r) => r.id),
        onSuccess: (id) => {
            toast.success("Empresa criada!");
            queryClient.invalidateQueries({ queryKey: ["platform", "companies"] });
            onCreated(id);
        },
        onError: (e: Error) => toast.error(e.message),
    });

    function set(k: string, v: string) {
        setForm((f) => ({ ...f, [k]: v }));
    }

    const canSubmit = form.name.trim() && form.plan_id;

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent
                hideClose
                className="max-w-md gap-0 overflow-hidden rounded-2xl p-0"
                aria-describedby={undefined}
            >
                <DialogHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4 text-left">
                    <DialogTitle className="text-sm font-semibold">Nova Empresa</DialogTitle>
                </DialogHeader>

                <div className="space-y-3 p-5">
                    <Field
                        label="Nome *"
                        value={form.name}
                        onChange={(v) => set("name", v)}
                        placeholder="Distribuidora ABC"
                    />
                    <Field
                        label="E-mail"
                        value={form.email}
                        onChange={(v) => set("email", v)}
                        placeholder="contato@empresa.com"
                        type="email"
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label="Slug"
                            value={form.slug}
                            onChange={(v) => set("slug", v)}
                            placeholder="distribuidora-abc"
                        />
                        <Field
                            label="Telefone"
                            value={form.phone}
                            onChange={(v) => set("phone", v)}
                            placeholder="(66) 99999-9999"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label="CNPJ"
                            value={form.cnpj}
                            onChange={(v) => set("cnpj", v)}
                            placeholder="00.000.000/0001-00"
                        />
                        <Field
                            label="Cidade"
                            value={form.cidade}
                            onChange={(v) => set("cidade", v)}
                            placeholder="Sinop"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            Plano *
                        </label>
                        <Select
                            value={form.plan_id || undefined}
                            onValueChange={(v) => set("plan_id", v)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione um plano" />
                            </SelectTrigger>
                            <SelectContent>
                                {plans.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name} — R${" "}
                                        {(p.price_cents / 100)
                                            .toFixed(2)
                                            .replaceAll(".", ",")}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter className="flex-row justify-end gap-2 border-t border-border px-5 py-4 sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={() => create.mutate()}
                        disabled={!canSubmit || create.isPending}
                        className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                        {create.isPending && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Criar empresa
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {label}
            </label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
        </div>
    );
}

export default function EmpresasPage() {
    const searchParams = useSearchParams();
    const [showModal, setShowModal] = useState(false);
    const [page, setPage] = useState(0);
    const [filters, setFilters] = useState<PlatformCompaniesFilter>(() =>
        parseCompaniesFilterFromSearchParams(
            new URLSearchParams(searchParams?.toString() ?? "")
        )
    );
    const filterQuery = useMemo(
        () => companiesFilterQueryString(filters),
        [filters]
    );

    useEffect(() => {
        setPage(0);
    }, [filterQuery]);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["platform", "companies", page, filterQuery],
        queryFn: () =>
            platformApi.companies(
                `${filterQuery}&page=${page}&limit=${LIMIT}`
            ),
        staleTime: 30_000,
    });

    const { data: plans = [] } = useQuery({
        queryKey: ["platform", "plans"],
        queryFn: () => platformApi.plans().then((r) => r.plans),
        staleTime: Infinity,
    });

    const companies = data?.companies ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / LIMIT));
    const summary = data?.summary;

    function exportCsv() {
        window.open(
            platformApi.companiesExportUrl(`${filterQuery}&page=0`),
            "_blank"
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                        Empresas
                    </h1>
                    <p className="text-xs text-zinc-500">
                        {total} no filtro · cadastro, conta, plano e canais
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50"
                    >
                        <RefreshCcw
                            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
                        />
                        Atualizar
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-primary shadow-[0_0_14px_rgba(87,255,143,0.35)] transition-all hover:bg-orange-600"
                    >
                        <Plus className="h-4 w-4" />
                        Nova Empresa
                    </button>
                </div>
            </div>

            <PlatformCompaniesFiltersBar
                value={filters}
                onChange={setFilters}
                plans={plans}
                summary={summary}
                onExportCsv={exportCsv}
            />

            {isLoading && (
                <div className="flex items-center justify-center py-20 text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
                    Erro ao carregar empresas: {(error as Error).message}
                </div>
            )}

            {!isLoading && !error && (
                <>
                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        {companies.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-16 text-zinc-400">
                                <Building2 className="h-8 w-8 opacity-30" />
                                <p className="text-sm">
                                    Nenhuma empresa neste filtro
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[960px] text-sm">
                                    <thead>
                                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                            <Th>Empresa</Th>
                                            <Th>Plano</Th>
                                            <Th>Conta</Th>
                                            <Th>Assinatura</Th>
                                            <Th>Onboarding</Th>
                                            <Th>WA</Th>
                                            <Th>Pedidos</Th>
                                            <Th>Última ativ.</Th>
                                            <Th>Cadastro</Th>
                                            <Th className="w-8" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {companies.map((c) => {
                                            const sub = c.subscription;
                                            const status =
                                                (sub?.status as string) ??
                                                "inactive";
                                            const plan =
                                                sub?.plans?.name ?? "—";
                                            return (
                                                <tr
                                                    key={c.id}
                                                    className="group transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                                            {c.name ??
                                                                "(sem nome)"}
                                                        </div>
                                                        <div className="text-[11px] text-zinc-400">
                                                            {c.email ??
                                                                c.slug ??
                                                                "—"}
                                                            {c.cidade
                                                                ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ""}`
                                                                : ""}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                                                        {plan}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span
                                                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                                c.is_active
                                                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                            }`}
                                                        >
                                                            {c.is_active
                                                                ? "Ativa"
                                                                : "Suspensa"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span
                                                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUB_STYLES[status] ?? SUB_STYLES.inactive}`}
                                                        >
                                                            {PLATFORM_SUB_STATUS_LABELS[
                                                                status as PlatformSubStatus
                                                            ] ?? status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-500">
                                                        {c.onboarding_completed_at
                                                            ? "OK"
                                                            : "Pendente"}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-500">
                                                        {c.channelCount === 0
                                                            ? "—"
                                                            : `${c.activeChannelCount}/${c.channelCount}`}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                                                        {c.orderCount ?? 0}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-400">
                                                        {c.lastOrderAt
                                                            ? timeAgo(
                                                                  c.lastOrderAt
                                                              )
                                                            : "—"}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-400">
                                                        <div>
                                                            {c.created_at
                                                                ? fmtDate(
                                                                      c.created_at
                                                                  )
                                                                : "—"}
                                                        </div>
                                                        <div className="text-[10px]">
                                                            {c.created_at
                                                                ? timeAgo(
                                                                      c.created_at
                                                                  )
                                                                : ""}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Link
                                                            href={`/platform/empresas/${c.id}`}
                                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                                                        >
                                                            <ChevronRight className="h-4 w-4" />
                                                        </Link>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-3">
                            <button
                                type="button"
                                onClick={() =>
                                    setPage((p) => Math.max(0, p - 1))
                                }
                                disabled={page === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs text-zinc-500">
                                Página {page + 1} de {totalPages}
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    setPage((p) =>
                                        Math.min(totalPages - 1, p + 1)
                                    )
                                }
                                disabled={page >= totalPages - 1}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </>
            )}

            {showModal && plans.length > 0 && (
                <NovaEmpresaModal
                    plans={plans}
                    onClose={() => setShowModal(false)}
                    onCreated={() => setShowModal(false)}
                />
            )}
        </div>
    );
}

function Th({
    children,
    className = "",
}: {
    children?: ReactNode;
    className?: string;
}) {
    return (
        <th
            className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 ${className}`}
        >
            {children}
        </th>
    );
}
