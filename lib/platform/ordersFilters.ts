import type { OrderStatus } from "@/lib/orders/types";

export const PLATFORM_ORDER_STATUSES = [
    "new",
    "preparing",
    "delivered",
    "finalized",
    "canceled",
] as const satisfies readonly OrderStatus[];

export type PlatformOrderStatusFilter = "all" | OrderStatus;

export type PlatformOrdersFilter = {
    status: PlatformOrderStatusFilter;
    /** ISO date YYYY-MM-DD inclusive start (UTC date boundary applied as local midnight → ISO) */
    dateFrom: string | "all";
    dateTo: string | "all";
    companyId: string | "all";
};

export const PLATFORM_ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    new: "Novo",
    preparing: "Preparando",
    delivered: "Entregue",
    finalized: "Finalizado",
    canceled: "Cancelado",
};

export const PLATFORM_ORDER_STATUS_CHIP: Record<
    OrderStatus,
    { label: string; cls: string }
> = {
    new: {
        label: "Novo",
        cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    preparing: {
        label: "Preparando",
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    },
    delivered: {
        label: "Entregue",
        cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    finalized: {
        label: "Finalizado",
        cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    },
    canceled: {
        label: "Cancelado",
        cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
};

/** Statuses included in revenue when status filter is `all` (receita real). */
export const REVENUE_STATUSES_WHEN_ALL: OrderStatus[] = [
    "new",
    "preparing",
    "delivered",
    "finalized",
];

export function defaultOrdersFilter(): PlatformOrdersFilter {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
        status: "all",
        dateFrom: toDateInputValue(from),
        dateTo: toDateInputValue(now),
        companyId: "all",
    };
}

export function toDateInputValue(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Início do dia local → ISO UTC */
export function dateFromToIsoStart(dateFrom: string): string {
    const [y, m, d] = dateFrom.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 0, 0, 0, 0).toISOString();
}

/** Fim do dia local → ISO UTC */
export function dateToToIsoEnd(dateTo: string): string {
    const [y, m, d] = dateTo.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 23, 59, 59, 999).toISOString();
}

function parseDateBound(
    sp: URLSearchParams,
    key: "date_from" | "date_to",
    fallback: string
): string | "all" {
    if (!sp.has(key)) return fallback;
    const raw = (sp.get(key) ?? "").trim();
    if (!raw || raw === "all") return "all";
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

export function parseOrdersFilterFromSearchParams(
    sp: URLSearchParams
): PlatformOrdersFilter {
    const defaults = defaultOrdersFilter();
    const statusRaw = sp.get("status") ?? "all";
    const status: PlatformOrderStatusFilter =
        statusRaw === "all" ||
        (PLATFORM_ORDER_STATUSES as readonly string[]).includes(statusRaw)
            ? (statusRaw as PlatformOrderStatusFilter)
            : "all";

    const companyRaw = (sp.get("company_id") ?? "all").trim();

    return {
        status,
        dateFrom: parseDateBound(sp, "date_from", defaults.dateFrom),
        dateTo: parseDateBound(sp, "date_to", defaults.dateTo),
        companyId: companyRaw || "all",
    };
}

/** Sempre serializa os 4 campos — `all` explícito evita o server cair no default do mês. */
export function ordersFilterToSearchParams(f: PlatformOrdersFilter): URLSearchParams {
    const sp = new URLSearchParams();
    sp.set("status", f.status);
    sp.set("date_from", f.dateFrom);
    sp.set("date_to", f.dateTo);
    sp.set("company_id", f.companyId);
    return sp;
}

export function ordersFilterQueryString(f: PlatformOrdersFilter): string {
    return ordersFilterToSearchParams(f).toString();
}

export function isOrderStatus(v: string): v is OrderStatus {
    return (PLATFORM_ORDER_STATUSES as readonly string[]).includes(v);
}
