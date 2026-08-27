"use client";

import {
    PLATFORM_ORDER_STATUSES,
    PLATFORM_ORDER_STATUS_LABELS,
    type PlatformOrdersFilter,
    type PlatformOrderStatusFilter,
} from "@/lib/platform/ordersFilters";

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

    return (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap gap-2">
                <Chip
                    active={value.status === "all"}
                    onClick={() => setStatus("all")}
                    label="Todos"
                />
                {PLATFORM_ORDER_STATUSES.map((s) => (
                    <Chip
                        key={s}
                        active={value.status === s}
                        onClick={() => setStatus(s)}
                        label={PLATFORM_ORDER_STATUS_LABELS[s]}
                    />
                ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-zinc-500">
                    De
                    <div className="mt-1 flex gap-1">
                        <input
                            type="date"
                            value={value.dateFrom === "all" ? "" : value.dateFrom}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    dateFrom: e.target.value || "all",
                                })
                            }
                            className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <button
                            type="button"
                            className="rounded-lg border border-zinc-200 px-2 text-[10px] dark:border-zinc-700"
                            onClick={() => onChange({ ...value, dateFrom: "all" })}
                        >
                            Todos
                        </button>
                    </div>
                </label>
                <label className="text-xs text-zinc-500">
                    Até
                    <div className="mt-1 flex gap-1">
                        <input
                            type="date"
                            value={value.dateTo === "all" ? "" : value.dateTo}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    dateTo: e.target.value || "all",
                                })
                            }
                            className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <button
                            type="button"
                            className="rounded-lg border border-zinc-200 px-2 text-[10px] dark:border-zinc-700"
                            onClick={() => onChange({ ...value, dateTo: "all" })}
                        >
                            Todos
                        </button>
                    </div>
                </label>
                <label className="text-xs text-zinc-500">
                    Empresa
                    <select
                        value={value.companyId}
                        onChange={(e) =>
                            onChange({ ...value, companyId: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    >
                        <option value="all">Todas</option>
                        {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {summary ? (
                <div className="flex flex-wrap items-baseline gap-4 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                    <span>
                        Pedidos:{" "}
                        <strong className="text-zinc-900 dark:text-zinc-100">
                            {summary.ordersCount.toLocaleString("pt-BR")}
                        </strong>
                    </span>
                    <span>
                        Receita:{" "}
                        <strong className="text-zinc-900 dark:text-zinc-100">
                            {formatCurrency(summary.revenue)}
                        </strong>
                    </span>
                    {summary.revenueNote ? (
                        <span className="text-zinc-400">{summary.revenueNote}</span>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function Chip({
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
            className={[
                "rounded-full px-3 py-1 text-xs font-medium transition",
                active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
            ].join(" ")}
        >
            {label}
        </button>
    );
}
