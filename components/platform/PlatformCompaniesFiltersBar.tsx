"use client";

import {
    AlertCircle,
    Building2,
    Calendar,
    CreditCard,
    Download,
    Search,
    SlidersHorizontal,
    Users,
} from "lucide-react";
import {
    applyDatePreset,
    type PlatformDatePreset,
} from "@/lib/platform/ordersFilters";
import {
    PLATFORM_ACCOUNT_FILTERS,
    PLATFORM_COMPANY_SORTS,
    PLATFORM_DATE_PRESET_LABELS,
    PLATFORM_DATE_PRESETS,
    PLATFORM_ONBOARDING_FILTERS,
    PLATFORM_SUB_STATUS_LABELS,
    PLATFORM_SUB_STATUSES,
    PLATFORM_WA_FILTERS,
    type PlatformCompaniesFilter,
    type PlatformCompanySort,
} from "@/lib/platform/companiesFilters";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";

type PlanOpt = { id: string; name: string; key?: string };
type Summary = {
    total: number;
    active: number;
    suspended: number;
    onboardingPending: number;
    trial: number;
    blocked: number;
};

type Props = {
    value: PlatformCompaniesFilter;
    onChange: (next: PlatformCompaniesFilter) => void;
    plans: PlanOpt[];
    summary?: Summary;
    onExportCsv?: () => void;
};

const ACCOUNT_LABEL: Record<(typeof PLATFORM_ACCOUNT_FILTERS)[number], string> = {
    all: "Todas",
    active: "Ativas",
    suspended: "Suspensas",
};

const ONBOARDING_LABEL: Record<
    (typeof PLATFORM_ONBOARDING_FILTERS)[number],
    string
> = {
    all: "Onboarding",
    done: "Concluído",
    pending: "Pendente",
};

const WA_LABEL: Record<(typeof PLATFORM_WA_FILTERS)[number], string> = {
    all: "Canal WA",
    none: "Sem canal",
    active: "WA ativo",
    inactive: "WA inativo",
};

const SORT_LABEL: Record<PlatformCompanySort, string> = {
    created_at: "Cadastro",
    name: "Nome",
    order_count: "Pedidos",
    last_order_at: "Última atividade",
};

export default function PlatformCompaniesFiltersBar({
    value,
    onChange,
    plans,
    summary,
    onExportCsv,
}: Props) {
    function setPreset(preset: PlatformDatePreset) {
        onChange({ ...value, ...applyDatePreset(preset, value) });
    }

    function DenseSelects() {
        return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SelectField
                    label="Plano"
                    value={value.planId}
                    onChange={(planId) => onChange({ ...value, planId })}
                    options={[
                        { value: "all", label: "Todos" },
                        ...plans.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                />
                <SelectField
                    label="Onboarding"
                    value={value.onboarding}
                    onChange={(onboarding) =>
                        onChange({
                            ...value,
                            onboarding:
                                onboarding as PlatformCompaniesFilter["onboarding"],
                        })
                    }
                    options={PLATFORM_ONBOARDING_FILTERS.map((o) => ({
                        value: o,
                        label: ONBOARDING_LABEL[o],
                    }))}
                />
                <SelectField
                    label="WhatsApp"
                    value={value.wa}
                    onChange={(wa) =>
                        onChange({
                            ...value,
                            wa: wa as PlatformCompaniesFilter["wa"],
                        })
                    }
                    options={PLATFORM_WA_FILTERS.map((w) => ({
                        value: w,
                        label: WA_LABEL[w],
                    }))}
                />
                <SelectField
                    label="Ordenar"
                    value={value.sort}
                    onChange={(sort) =>
                        onChange({
                            ...value,
                            sort: sort as PlatformCompanySort,
                        })
                    }
                    options={PLATFORM_COMPANY_SORTS.map((s) => ({
                        value: s,
                        label: SORT_LABEL[s],
                    }))}
                />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input
                        value={value.q}
                        onChange={(e) => onChange({ ...value, q: e.target.value })}
                        placeholder="Buscar nome, e-mail, slug, CNPJ…"
                        className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm text-zinc-800 placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                </div>

                <Sheet>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 md:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            aria-label="Abrir filtros"
                        >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Filtros
                        </button>
                    </SheetTrigger>
                    <SheetContent
                        side="bottom"
                        className="max-h-[85vh] rounded-t-2xl md:hidden"
                        onInteractOutside={(e) => {
                            const t = e.target as HTMLElement | null;
                            if (t?.closest?.('[role="listbox"]')) {
                                e.preventDefault();
                            }
                        }}
                    >
                        <SheetHeader>
                            <SheetTitle>Filtros</SheetTitle>
                        </SheetHeader>
                        <div className="mt-4 space-y-4 pb-2">
                            <DenseSelects />
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            <div className="-mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {PLATFORM_DATE_PRESETS.map((p) => (
                    <button
                        key={p}
                        type="button"
                        onClick={() => setPreset(p)}
                        className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3 ${
                            value.datePreset === p
                                ? "border-violet-600 bg-violet-600 text-white"
                                : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                    >
                        <Calendar className="h-3 w-3" />
                        {PLATFORM_DATE_PRESET_LABELS[p]}
                    </button>
                ))}
            </div>

            <div className="-mx-1 max-w-full overflow-x-auto px-1 scrollbar-hide sm:mx-0 sm:px-0">
                <div className="flex w-max min-w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50 sm:w-fit">
                    {PLATFORM_ACCOUNT_FILTERS.map((a) => (
                        <Seg
                            key={a}
                            active={value.account === a}
                            label={ACCOUNT_LABEL[a]}
                            onClick={() => onChange({ ...value, account: a })}
                        />
                    ))}
                </div>
            </div>

            <div className="-mx-1 max-w-full overflow-x-auto px-1 scrollbar-hide sm:mx-0 sm:px-0">
                <div className="flex w-max min-w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50 sm:w-fit">
                    <Seg
                        active={value.subStatus === "all"}
                        label="Assinatura"
                        onClick={() => onChange({ ...value, subStatus: "all" })}
                    />
                    {PLATFORM_SUB_STATUSES.map((s) => (
                        <Seg
                            key={s}
                            active={value.subStatus === s}
                            label={PLATFORM_SUB_STATUS_LABELS[s]}
                            onClick={() => onChange({ ...value, subStatus: s })}
                        />
                    ))}
                </div>
            </div>

            {value.datePreset === "custom" && (
                <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
                    <p className="text-xs font-medium text-zinc-500">Cadastro de</p>
                    <input
                        type="date"
                        value={value.dateFrom === "all" ? "" : value.dateFrom}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                datePreset: "custom",
                                dateFrom: e.target.value || "all",
                            })
                        }
                        className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                    />
                    <p className="text-xs font-medium text-zinc-500">até</p>
                    <input
                        type="date"
                        value={value.dateTo === "all" ? "" : value.dateTo}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                datePreset: "custom",
                                dateTo: e.target.value || "all",
                            })
                        }
                        className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                    />
                </div>
            )}

            <div className="hidden md:block">
                <DenseSelects />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-medium text-zinc-500">
                    Cidade
                    <input
                        value={value.cidade}
                        onChange={(e) =>
                            onChange({ ...value, cidade: e.target.value })
                        }
                        placeholder="Todas"
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
                    />
                </label>
                <label className="text-xs font-medium text-zinc-500">
                    UF
                    <input
                        value={value.uf === "all" ? "" : value.uf}
                        maxLength={2}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                uf: e.target.value.trim().toUpperCase() || "all",
                            })
                        }
                        placeholder="Todas"
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm uppercase focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
                    />
                </label>
                {onExportCsv ? (
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={onExportCsv}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Exportar CSV
                        </button>
                    </div>
                ) : null}
            </div>

            {summary ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <SummaryCard
                        label="Total"
                        value={summary.total}
                        icon={Users}
                        color="text-violet-500"
                        bg="bg-violet-50 dark:bg-violet-900/20"
                    />
                    <SummaryCard
                        label="Ativas"
                        value={summary.active}
                        icon={Building2}
                        color="text-emerald-500"
                        bg="bg-emerald-50 dark:bg-emerald-900/20"
                    />
                    <SummaryCard
                        label="Suspensas"
                        value={summary.suspended}
                        icon={AlertCircle}
                        color="text-red-500"
                        bg="bg-red-50 dark:bg-red-900/20"
                    />
                    <SummaryCard
                        label="Onb. pendente"
                        value={summary.onboardingPending}
                        icon={CreditCard}
                        color="text-orange-500"
                        bg="bg-orange-50 dark:bg-orange-900/20"
                    />
                    <SummaryCard
                        label="Trial"
                        value={summary.trial}
                        icon={CreditCard}
                        color="text-blue-500"
                        bg="bg-blue-50 dark:bg-blue-900/20"
                    />
                    <SummaryCard
                        label="Blocked"
                        value={summary.blocked}
                        icon={AlertCircle}
                        color="text-amber-600"
                        bg="bg-amber-50 dark:bg-amber-900/20"
                    />
                </div>
            ) : null}
        </div>
    );
}

function Seg({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold sm:px-4 ${
                active
                    ? "bg-white text-violet-700 shadow dark:bg-zinc-800 dark:text-violet-400"
                    : "text-zinc-500"
            }`}
        >
            {label}
        </button>
    );
}

function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <label className="text-xs font-medium text-zinc-500">
            {label}
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </label>
    );
}

function SummaryCard({
    label,
    value,
    icon: Icon,
    color,
    bg,
}: {
    label: string;
    value: number;
    icon: typeof Users;
    color: string;
    bg: string;
}) {
    return (
        <div
            className={`flex items-center gap-3 rounded-xl border border-zinc-100 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 ${bg}`}
        >
            <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 ${color}`}
            >
                <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
                <p className="text-lg font-black text-zinc-900 dark:text-zinc-50">
                    {value.toLocaleString("pt-BR")}
                </p>
                <p className="text-[11px] text-zinc-500">{label}</p>
            </div>
        </div>
    );
}
