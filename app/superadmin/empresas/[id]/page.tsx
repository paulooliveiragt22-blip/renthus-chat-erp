"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, Building2, CheckCircle2, Loader2, MessageSquare,
    Pencil, Plus, Receipt, RefreshCcw, Save, Wifi, WifiOff, X,
} from "lucide-react";
import {
    createChannel, getCompany, getPlans,
    updateChannelCredentials, updateChannelStatus, updateCompany, updateSubscription,
} from "@/lib/superadmin/actions";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}
function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
    new:       { label: "Novo",       cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    confirmed: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    delivered: { label: "Entregue",   cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
    cancelled: { label: "Cancelado",  cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const SUB_STATUS = ["active", "trial", "blocked", "inactive", "cancelled"];

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function Field({
    label, value, onChange, placeholder, type = "text", readOnly,
}: {
    label: string; value: string; onChange?: (v: string) => void;
    placeholder?: string; type?: string; readOnly?: boolean;
}) {
    return (
        <div>
            <label className="mb-1 block text-xs text-zinc-400">{label}</label>
            <input
                type={type}
                value={value}
                readOnly={readOnly}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none transition",
                    readOnly
                        ? "border-zinc-100 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400"
                        : "border-zinc-300 bg-white text-zinc-900 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
                ].join(" ")}
            />
        </div>
    );
}

// ─── Modal: Adicionar Canal WA ────────────────────────────────────────────────

function AdicionarCanalModal({
    companyId, onClose,
}: {
    companyId: string; onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState({
        phone_number_id: "",
        access_token:    "",
        waba_id:         "",
        whatsapp_phone:  "",
    });

    const create = useMutation({
        mutationFn: () => createChannel(companyId, form),
        onSuccess: () => {
            toast.success("Canal adicionado!");
            queryClient.invalidateQueries({ queryKey: ["sa", "company", companyId] });
            onClose();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

    const canSubmit = form.phone_number_id.trim() && form.access_token.trim();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Adicionar Canal WhatsApp</h2>
                    <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-3 p-5">
                    <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Encontre esses dados em <strong>Meta Developer Portal</strong> → seu App → WhatsApp → Configuração da API
                    </div>

                    <Field
                        label="Phone Number ID *"
                        value={form.phone_number_id}
                        onChange={(v) => set("phone_number_id", v)}
                        placeholder="1043863512143674"
                    />
                    <Field
                        label="Access Token *"
                        value={form.access_token}
                        onChange={(v) => set("access_token", v)}
                        placeholder="EAAxxxxxxxx..."
                        type="password"
                    />
                    <Field
                        label="WABA ID (opcional)"
                        value={form.waba_id}
                        onChange={(v) => set("waba_id", v)}
                        placeholder="105xxxxxxxxx"
                    />
                    <Field
                        label="Número visível (ex: 5566992285005)"
                        value={form.whatsapp_phone}
                        onChange={(v) => set("whatsapp_phone", v)}
                        placeholder="5566992285005"
                    />
                </div>

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
                        Adicionar canal
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Modal: Editar Credenciais do Canal ───────────────────────────────────────

function EditarCredenciaisModal({
    channel, onClose,
}: {
    channel: any; onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const companyId   = channel.company_id as string;
    const meta        = (channel.provider_metadata ?? {}) as Record<string, string>;

    const [form, setForm] = useState({
        phone_number_id: channel.from_identifier ?? "",
        access_token:    "",
        waba_id:         meta.waba_id ?? "",
    });

    const save = useMutation({
        mutationFn: () => updateChannelCredentials(channel.id, form),
        onSuccess: () => {
            toast.success("Credenciais atualizadas!");
            queryClient.invalidateQueries({ queryKey: ["sa", "company"] });
            queryClient.invalidateQueries({ queryKey: ["sa", "channels"] });
            onClose();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Editar Credenciais</h2>
                    <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-3 p-5">
                    <Field
                        label="Phone Number ID"
                        value={form.phone_number_id}
                        onChange={(v) => set("phone_number_id", v)}
                        placeholder="1043863512143674"
                    />
                    <Field
                        label="Access Token (deixe em branco para manter)"
                        value={form.access_token}
                        onChange={(v) => set("access_token", v)}
                        placeholder="EAAxxxxxxxx..."
                        type="password"
                    />
                    <Field
                        label="WABA ID"
                        value={form.waba_id}
                        onChange={(v) => set("waba_id", v)}
                        placeholder="105xxxxxxxxx"
                    />
                    <p className="text-[11px] text-zinc-400">
                        Access Token atual: {meta.access_token ? `${meta.access_token.slice(0, 12)}…` : "(não configurado)"}
                    </p>
                </div>

                <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
                    <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
                        Cancelar
                    </button>
                    <button
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                    >
                        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Salvar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CompanyDetailPage({ params }: { params: { id: string } }) {
    const { id }      = params;
    const queryClient = useQueryClient();
    const [tab, setTab]             = useState<"info" | "canais" | "pedidos">("info");
    const [editingInfo, setEditingInfo]   = useState(false);
    const [editingInfo2, setEditingInfo2] = useState(false);  // subscription
    const [showAddChannel, setShowAddChannel]     = useState(false);
    const [editingChannel, setEditingChannel]     = useState<any | null>(null);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["sa", "company", id],
        queryFn:  () => getCompany(id),
    });

    const { data: plans = [] } = useQuery({
        queryKey: ["sa", "plans"],
        queryFn:  () => getPlans(),
        staleTime: Infinity,
    });

    // ── Estados de edição ────────────────────────────────────────────────────
    const [compForm, setCompForm] = useState<Record<string, string>>({});
    const [subForm,  setSubForm]  = useState<Record<string, string>>({});

    function startEditInfo() {
        const c = (data as any).company;
        setCompForm({
            name:           c.name          ?? "",
            email:          c.email         ?? "",
            slug:           c.slug          ?? "",
            cnpj:           c.cnpj          ?? "",
            razao_social:   c.razao_social  ?? "",
            nome_fantasia:  c.nome_fantasia ?? "",
            phone:          c.phone         ?? "",
            whatsapp_phone: c.whatsapp_phone ?? "",
            cidade:         c.cidade        ?? "",
            cep:            c.cep           ?? "",
            endereco:       c.endereco      ?? "",
            numero:         c.numero        ?? "",
            bairro:         c.bairro        ?? "",
            uf:             c.uf            ?? "",
        });
        setEditingInfo(true);
    }

    function startEditSub() {
        const sub = (data as any).sub;
        setSubForm({
            plan_id: sub?.plans?.id ?? sub?.plan_id ?? plans[0]?.id ?? "",
            status:  sub?.status   ?? "active",
        });
        setEditingInfo2(true);
    }

    const saveComp = useMutation({
        mutationFn: () => updateCompany(id, compForm as any),
        onSuccess: () => {
            toast.success("Empresa atualizada!");
            queryClient.invalidateQueries({ queryKey: ["sa", "company", id] });
            queryClient.invalidateQueries({ queryKey: ["sa", "companies"] });
            setEditingInfo(false);
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const saveSub = useMutation({
        mutationFn: () => {
            const sub = (data as any).sub;
            return updateSubscription(sub.id, subForm as any);
        },
        onSuccess: () => {
            toast.success("Assinatura atualizada!");
            queryClient.invalidateQueries({ queryKey: ["sa", "company", id] });
            queryClient.invalidateQueries({ queryKey: ["sa", "companies"] });
            setEditingInfo2(false);
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const toggleChannel = useMutation({
        mutationFn: ({ channelId, status }: { channelId: string; status: "active" | "inactive" }) =>
            updateChannelStatus(channelId, status),
        onSuccess: () => {
            toast.success("Canal atualizado");
            queryClient.invalidateQueries({ queryKey: ["sa", "company", id] });
        },
        onError: (e: Error) => toast.error(e.message),
    });

    // ── Loading / erro ───────────────────────────────────────────────────────
    if (isLoading) return (
        <div className="flex items-center justify-center py-20 text-zinc-400">
            <Loader2 className="h-6 w-6 animate-spin" />
        </div>
    );

    if (error || !data) return (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            Empresa não encontrada ou erro ao carregar.
        </div>
    );

    const { company, sub, channels, orders } = data as any;

    return (
        <div className="space-y-5">
            {/* ── Cabeçalho ────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
                <Link
                    href="/superadmin/empresas"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                        {company.name ?? "(sem nome)"}
                    </h1>
                    <p className="text-xs text-zinc-400">{company.email ?? company.slug ?? "—"}</p>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-500 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                {(["info", "canais", "pedidos"] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={[
                            "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium capitalize transition",
                            tab === t
                                ? "bg-white shadow text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                        ].join(" ")}
                    >
                        {t === "info"    && <Building2    className="h-3.5 w-3.5" />}
                        {t === "canais"  && <MessageSquare className="h-3.5 w-3.5" />}
                        {t === "pedidos" && <Receipt       className="h-3.5 w-3.5" />}
                        <span>{t === "info" ? "Informações" : t === "canais" ? `Canais (${channels.length})` : `Pedidos (${orders.length})`}</span>
                    </button>
                ))}
            </div>

            {/* ── Tab: Info ────────────────────────────────────────────────── */}
            {tab === "info" && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {/* Dados da empresa */}
                    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Dados da empresa</h2>
                            {!editingInfo ? (
                                <button
                                    onClick={startEditInfo}
                                    className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                >
                                    <Pencil className="h-3 w-3" /> Editar
                                </button>
                            ) : (
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={() => setEditingInfo(false)}
                                        className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-50 dark:border-zinc-700"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => saveComp.mutate()}
                                        disabled={saveComp.isPending}
                                        className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                                    >
                                        {saveComp.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                        Salvar
                                    </button>
                                </div>
                            )}
                        </div>

                        {editingInfo ? (
                            <div className="space-y-2.5">
                                {[
                                    ["name",          "Nome"],
                                    ["email",         "E-mail"],
                                    ["slug",          "Slug"],
                                    ["cnpj",          "CNPJ"],
                                    ["razao_social",  "Razão Social"],
                                    ["nome_fantasia", "Nome Fantasia"],
                                    ["phone",         "Telefone"],
                                    ["whatsapp_phone","WhatsApp (número visível)"],
                                    ["cidade",        "Cidade"],
                                    ["cep",           "CEP"],
                                    ["endereco",      "Endereço"],
                                    ["numero",        "Número"],
                                    ["bairro",        "Bairro"],
                                    ["uf",            "UF"],
                                ].map(([k, label]) => (
                                    <Field
                                        key={k}
                                        label={label}
                                        value={compForm[k] ?? ""}
                                        onChange={(v) => setCompForm((f) => ({ ...f, [k]: v }))}
                                    />
                                ))}
                            </div>
                        ) : (
                            <dl className="space-y-3">
                                {[
                                    ["Nome",           company.name],
                                    ["Slug",           company.slug],
                                    ["CNPJ",           company.cnpj],
                                    ["Razão Social",   company.razao_social],
                                    ["Nome Fantasia",  company.nome_fantasia],
                                    ["E-mail",         company.email],
                                    ["Telefone",       company.phone],
                                    ["WhatsApp",       company.whatsapp_phone],
                                    ["Cidade",         company.cidade],
                                    ["CEP",            company.cep],
                                    ["Endereço",       company.endereco ? `${company.endereco}, ${company.numero ?? ""}` : null],
                                ].map(([k, v]) => v ? (
                                    <div key={k as string} className="flex justify-between gap-2">
                                        <dt className="text-xs text-zinc-400">{k}</dt>
                                        <dd className="text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{v}</dd>
                                    </div>
                                ) : null)}
                            </dl>
                        )}
                    </div>

                    {/* Plano & Assinatura */}
                    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Plano & Assinatura</h2>
                            {sub && !editingInfo2 ? (
                                <button
                                    onClick={startEditSub}
                                    className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                >
                                    <Pencil className="h-3 w-3" /> Editar
                                </button>
                            ) : sub && editingInfo2 ? (
                                <div className="flex gap-1.5">
                                    <button onClick={() => setEditingInfo2(false)} className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-50 dark:border-zinc-700">
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => saveSub.mutate()}
                                        disabled={saveSub.isPending}
                                        className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-light disabled:opacity-50"
                                    >
                                        {saveSub.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                        Salvar
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        {sub ? (
                            editingInfo2 ? (
                                <div className="space-y-2.5">
                                    <div>
                                        <label className="mb-1 block text-xs text-zinc-400">Plano</label>
                                        <select
                                            value={subForm.plan_id}
                                            onChange={(e) => setSubForm((f) => ({ ...f, plan_id: e.target.value }))}
                                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                        >
                                            {plans.map((p: any) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name} — R$ {(p.price_cents / 100).toFixed(2).replaceAll(".", ",")}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-zinc-400">Status</label>
                                        <select
                                            value={subForm.status}
                                            onChange={(e) => setSubForm((f) => ({ ...f, status: e.target.value }))}
                                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                        >
                                            {SUB_STATUS.map((s) => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <dl className="space-y-3">
                                    {[
                                        ["Plano",   sub.plans?.name],
                                        ["Status",  sub.status],
                                        ["Overage", sub.allow_overage ? "Sim" : "Não"],
                                    ].map(([k, v]) => (
                                        <div key={k as string} className="flex justify-between gap-2">
                                            <dt className="text-xs text-zinc-400">{k}</dt>
                                            <dd className="text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{v}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )
                        ) : (
                            <p className="text-xs text-zinc-400">Sem assinatura cadastrada</p>
                        )}

                        <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Onboarding</h2>
                            <div className="flex items-center gap-2 text-xs">
                                {company.onboarding_completed_at ? (
                                    <>
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                        <span className="text-zinc-600 dark:text-zinc-400">
                                            Concluído {timeAgo(company.onboarding_completed_at)}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-amber-500">Pendente</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Tab: Canais ──────────────────────────────────────────────── */}
            {tab === "canais" && (
                <div className="space-y-3">
                    <div className="flex justify-end">
                        <button
                            onClick={() => setShowAddChannel(true)}
                            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light"
                        >
                            <Plus className="h-3.5 w-3.5" /> Adicionar Canal
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        {channels.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
                                <MessageSquare className="h-7 w-7 opacity-30" />
                                <p className="text-sm">Nenhum canal configurado</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Phone Number ID</th>
                                        <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sm:table-cell">Token</th>
                                        <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sm:table-cell">Criado</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {channels.map((ch: any) => {
                                        const meta = (ch.provider_metadata ?? {}) as Record<string, string>;
                                        return (
                                            <tr key={ch.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                                <td className="px-4 py-3">
                                                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-mono dark:bg-zinc-800">
                                                        {ch.from_identifier || "—"}
                                                    </code>
                                                </td>
                                                <td className="hidden px-4 py-3 text-xs text-zinc-400 sm:table-cell">
                                                    {meta.access_token
                                                        ? <code className="text-[11px] font-mono">{meta.access_token.slice(0, 16)}…</code>
                                                        : <span className="text-amber-500">não configurado</span>}
                                                </td>
                                                <td className="hidden px-4 py-3 text-xs text-zinc-400 sm:table-cell">
                                                    {timeAgo(ch.created_at)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${ch.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                                                        {ch.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => setEditingChannel({ ...ch, company_id: id })}
                                                            title="Editar credenciais"
                                                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleChannel.mutate({
                                                                channelId: ch.id,
                                                                status: ch.status === "active" ? "inactive" : "active",
                                                            })}
                                                            disabled={toggleChannel.isPending}
                                                            title={ch.status === "active" ? "Desativar" : "Ativar"}
                                                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                                                        >
                                                            {ch.status === "active"
                                                                ? <WifiOff className="h-3.5 w-3.5" />
                                                                : <Wifi    className="h-3.5 w-3.5" />}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* ── Tab: Pedidos ─────────────────────────────────────────────── */}
            {tab === "pedidos" && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    {orders.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
                            <Receipt className="h-7 w-7 opacity-30" />
                            <p className="text-sm">Nenhum pedido</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">#</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Total</th>
                                    <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sm:table-cell">Pagamento</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                                    <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:table-cell">Data</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {orders.map((o: any) => {
                                    const st = ORDER_STATUS[o.status] ?? { label: o.status, cls: "bg-zinc-100 text-zinc-500" };
                                    return (
                                        <tr key={o.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                            <td className="px-4 py-3">
                                                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-mono dark:bg-zinc-800">
                                                    #{o.id.replaceAll("-", "").slice(-6).toUpperCase()}
                                                </code>
                                            </td>
                                            <td className="px-4 py-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                                {formatCurrency(o.total_amount ?? 0)}
                                            </td>
                                            <td className="hidden px-4 py-3 text-xs capitalize text-zinc-500 sm:table-cell">
                                                {o.payment_method ?? "—"}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                                                    {st.label}
                                                </span>
                                            </td>
                                            <td className="hidden px-4 py-3 text-xs text-zinc-400 lg:table-cell">
                                                {timeAgo(o.created_at)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* ── Modais ───────────────────────────────────────────────────── */}
            {showAddChannel && (
                <AdicionarCanalModal
                    companyId={id}
                    onClose={() => setShowAddChannel(false)}
                />
            )}
            {editingChannel && (
                <EditarCredenciaisModal
                    channel={editingChannel}
                    onClose={() => setEditingChannel(null)}
                />
            )}
        </div>
    );
}
