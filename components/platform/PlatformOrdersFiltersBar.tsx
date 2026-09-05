"use client";

import { Building2, Calendar, Receipt, SlidersHorizontal, TrendingUp } from "lucide-react";
import {
    applyDatePreset,
    PLATFORM_DATE_PRESET_LABELS,
    PLATFORM_DATE_PRESETS,
    PLATFORM_ORDER_STATUSES,
    PLATFORM_ORDER_STATUS_LABELS,
    type PlatformDatePreset,
    type PlatformOrdersFilter,
    type PlatformOrderStatusFilter,
} from "@/lib/platform/ordersFilters";
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

type CompanyOpt = { id: string; name: string };

type Props = {
    value: PlatformOrdersFilter;
    onChange: (next: PlatformOrdersFilter) => void;
    companies: CompanyOpt[];
    summary?: { ordersCount: number; revenue: number; revenueNote?: string | null };
};

function formatCurrency(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PlatformOrdersFiltersBar({
    value,
    onChange,
    companies,
    summary,
}: Props) {
    function setStatus(status: PlatformOrderStatusFilter) {
        onChange({ ...value, status });
    }

    function setPreset(preset: PlatformDatePreset) {
        onChange({ ...value, ...applyDatePreset(preset, value) });
    }

    function setCustomDate(
        patch: Partial<Pick<PlatformOrdersFilter, "dateFrom" | "dateTo">>
    ) {
        onChange({
            ...value,
            datePreset: "custom",
            ...patch,
        });
    }

    function CompanySelect() {
        return (
            <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-zinc-500">
                <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    Empresa
                </span>
                <Select
                    value={value.companyId}
                    onValueChange={(v) => onChange({ ...value, companyId: v })}
                >
                    <SelectTrigger className="rounded-xl">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {companies.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                                {c.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </label>
        );
    }

    return (
        <div className="space-y-4">
            {/* Período — mesmo padrão visual do Financeiro */}
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

            {/* Status — segmented control estilo abas Clientes/Financeiro */}
            <div className="-mx-1 max-w-full overflow-x-auto px-1 scrollbar-hide sm:mx-0 sm:px-0">
                <div className="flex w-max min-w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50 sm:w-fit sm:min-w-0">
                    <StatusTab
                        active={value.status === "all"}
                        onClick={() => setStatus("all")}
                        label="Todos"
                    />
                    {PLATFORM_ORDER_STATUSES.map((s) => (
                        <StatusTab
                            key={s}
                            active={value.status === s}
                            onClick={() => setStatus(s)}
                            label={PLATFORM_ORDER_STATUS_LABELS[s]}
                        />
                    ))}
                </div>
            </div>

            {/* Mobile: Sheet para Select de empresa */}
            <div className="md:hidden">
                <Sheet>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            aria-label="Abrir filtros"
                        >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Filtros
                        </button>
                    </SheetTrigger>
                    <SheetContent
                        side="bottom"
                        className="max-h-[85vh] rounded-t-2xl"
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
                            <CompanySelect />
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            {/* Personalizado + empresa (desktop) */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                {value.datePreset === "custom" && (
                    <div className="flex flex-1 flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:p-4">
                        <p className="text-xs font-medium text-zinc-500">De</p>
                        <input
                            type="date"
                            value={value.dateFrom === "all" ? "" : value.dateFrom}
                            onChange={(e) =>
                                setCustomDate({
                                    dateFrom: e.target.value || "all",
                                })
                            }
                            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                        />
                        <p className="text-xs font-medium text-zinc-500 sm:ml-1">até</p>
                        <input
                            type="date"
                            value={value.dateTo === "all" ? "" : value.dateTo}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) =>
                                setCustomDate({
                                    dateTo: e.target.value || "all",
                                })
                            }
                            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 sm:w-auto"
                        />
                    </div>
                )}

                <div className="hidden sm:ml-auto md:block">
                    <CompanySelect />
                </div>
            </div>

            {/* Cards resumo — layout Clientes */}
            {summary ? (
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-2">
                        <SummaryCard
                            label="Pedidos"
                            value={summary.ordersCount.toLocaleString("pt-BR")}
                            icon={Receipt}
                            color="text-violet-500"
                            bg="bg-violet-50 dark:bg-violet-900/20"
                        />
                        <SummaryCard
                            label="Receita"
                            value={formatCurrency(summary.revenue)}
                            icon={TrendingUp}
                            color="text-emerald-500"
                            bg="bg-emerald-50 dark:bg-emerald-900/20"
                        />
                    </div>
                    {summary.revenueNote ? (
                        <p className="text-[11px] text-zinc-400">{summary.revenueNote}</p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function StatusTab({
    active,
    onClick,
    label,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
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

function SummaryCard({
    label,
    value,
    icon: Icon,
    color,
    bg,
}: {
    label: string;
    value: string;
    icon: typeof Receipt;
    color: string;
    bg: string;
}) {
    return (
        <div
            className={`flex items-center gap-3 rounded-xl border border-zinc-100 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 ${bg}`}
        >
            <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 ${color}`}
            >
                <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
                <p className="truncate text-lg font-black text-zinc-900 dark:text-zinc-50">
                    {value}
                </p>
                <p className="text-[11px] text-zinc-500">{label}</p>
            </div>
        </div>
    );
}
