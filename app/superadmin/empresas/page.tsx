"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import {
    Building2, ChevronRight, Loader2, Plus, RefreshCcw, Search, X,
} from "lucide-react";
import { createCompany, getCompanies, getPlans } from "@/lib/superadmin/actions";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
    active:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    trial:    "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400",
    blocked:  "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400",
    inactive: "bg-zinc-100   text-zinc-500   dark:bg-zinc-800      dark:text-zinc-400",
};
const STATUS_LABEL: Record<string, string> = {
    active: "Ativo", trial: "Trial", blocked: "Bloqueado", inactive: "Inativo",
};

function timeAgo(iso: string) {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

const EMPTY_FORM = {
    name: "", email: "", slug: "", cnpj: "", phone: "", cidade: "", plan_id: "",
};

// ─── Modal Nova Empresa ───────────────────────────────────────────────────────

function NovaEmpresaModal({
    plans, onClose, onCreated,
}: {
    plans: any[];
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const [form, setForm] = useState({ ...EMPTY_FORM, plan_id: plans[0]?.id ?? "" });
    const queryClient     = useQueryClient();

    const create = useMutation({
        mutationFn: () => createCompany(form),
        onSuccess: (id) => {
            toast.success("Empresa criada!");
            queryClient.invalidateQueries({ queryKey: ["sa", "companies"] });
            onCreated(id);
        },
        onError: (e: Error) => toast.error(e.message),
    });

    function set(k: string, v: string) {
        setForm((f) => ({ ...f, [k]: v }));
    }

    const canSubmit = form.name.trim() && form.plan_id;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nova Empresa</h2>
                    <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-3 p-5">
                    <Field label="Nome *" value={form.name} onChange={(v) => set("name", v)} placeholder="Distribuidora ABC" />
                    <Field label="E-mail" value={form.email} onChange={(v) => set("email", v)} placeholder="contato@empresa.com" type="email" />
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Slug" value={form.slug} onChange={(v) => set("slug", v)} placeholder="distribuidora-abc" />
                        <Field label="Telefone" value={form.phone} onChange={(v) => set("phone", v)} placeholder="(66) 99999-9999" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="CNPJ" value={form.cnpj} onChange={(v) => set("cnpj", v)} placeholder="00.000.000/0001-00" />
                        <Field label="Cidade" value={form.cidade} onChange={(v) => set("cidade", v)} placeholder="Sinop" />
                    </div>

                    {/* Plano */}
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            Plano *
                        </label>
                        <select
                            value={form.plan_id}
                            onChange={(e) => set("plan_id", e.target.value)}
                            className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                            {plans.map((p: any) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} — R$ {(p.price_cents / 100).toFixed(2).replace(".", ",")}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <button
                        onClick={onClose}
                        className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => create.mutate()}
                        disabled={!canSubmit || create.isPending}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                    >
                        {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Criar empresa
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({
    label, value, onChange, placeholder, type = "text",
}: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string;
}) {
    return (
        <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
        </div>
    );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function EmpresasPage() {
    const [search, setSearch]   = useState("");
    const [showModal, setShowModal] = useState(false);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["sa", "companies"],
        queryFn:  () => getCompanies(),
        staleTime: 30_000,
    });

    const { data: plans = [] } = useQuery({
        queryKey: ["sa", "plans"],
        queryFn:  () => getPlans(),
        staleTime: Infinity,
    });

    const companies = (data ?? []).filter((c: any) =>
        !search ||
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase()) ||
        c.slug?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-5">
            {/* ── Cabeçalho ────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Empresas</h1>
                    <p className="text-xs text-zinc-500">{data?.length ?? 0} empresa(s) cadastrada(s)</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50"
                    >
                        <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                        Atualizar
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-light"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Nova Empresa
                    </button>
                </div>
            </div>

            {/* ── Busca ────────────────────────────────────────────────────── */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nome, email ou slug…"
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm text-zinc-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
            </div>

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

            {/* ── Tabela ───────────────────────────────────────────────────── */}
            {!isLoading && !error && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    {companies.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-16 text-zinc-400">
                            <Building2 className="h-8 w-8 opacity-30" />
                            <p className="text-sm">Nenhuma empresa encontrada</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Empresa</th>
                                    <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 md:table-cell">Plano</th>
                                    <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:table-cell">Pedidos</th>
                                    <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:table-cell">Cadastro</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                    <th className="w-8 px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {companies.map((c: any) => {
                                    const sub    = c.subscription;
                                    const status = sub?.status ?? "inactive";
                                    const plan   = sub?.plans?.name ?? "—";

                                    return (
                                        <tr key={c.id} className="group transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                            <td className="px-4 py-3">
                                                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                                    {c.name ?? "(sem nome)"}
                                                </div>
                                                <div className="text-[11px] text-zinc-400">
                                                    {c.email ?? c.slug ?? "—"}
                                                </div>
                                            </td>
                                            <td className="hidden px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 md:table-cell">
                                                {plan}
                                            </td>
                                            <td className="hidden px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 lg:table-cell">
                                                {c.orderCount}
                                            </td>
                                            <td className="hidden px-4 py-3 text-xs text-zinc-400 lg:table-cell">
                                                {timeAgo(c.created_at)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status] ?? STATUS_STYLES.inactive}`}>
                                                    {STATUS_LABEL[status] ?? status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link
                                                    href={`/superadmin/empresas/${c.id}`}
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
                    )}
                </div>
            )}

            {/* ── Modal ────────────────────────────────────────────────────── */}
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
