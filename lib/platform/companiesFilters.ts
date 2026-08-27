import {
    applyDatePreset,
    dateFromToIsoStart,
    dateToToIsoEnd,
    PLATFORM_DATE_PRESET_LABELS,
    PLATFORM_DATE_PRESETS,
    type PlatformDatePreset,
} from "@/lib/platform/ordersFilters";

export {
    PLATFORM_DATE_PRESETS,
    PLATFORM_DATE_PRESET_LABELS,
    type PlatformDatePreset,
};

export const PLATFORM_ACCOUNT_FILTERS = ["all", "active", "suspended"] as const;
export type PlatformAccountFilter = (typeof PLATFORM_ACCOUNT_FILTERS)[number];

export const PLATFORM_SUB_STATUSES = [
    "active",
    "trial",
    "blocked",
    "inactive",
    "cancelled",
] as const;
export type PlatformSubStatus = (typeof PLATFORM_SUB_STATUSES)[number];
export type PlatformSubStatusFilter = "all" | PlatformSubStatus;

export const PLATFORM_SUB_STATUS_LABELS: Record<PlatformSubStatus, string> = {
    active: "Ativo",
    trial: "Trial",
    blocked: "Bloqueado",
    inactive: "Inativo",
    cancelled: "Cancelado",
};

export const PLATFORM_ONBOARDING_FILTERS = ["all", "done", "pending"] as const;
export type PlatformOnboardingFilter = (typeof PLATFORM_ONBOARDING_FILTERS)[number];

export const PLATFORM_WA_FILTERS = ["all", "none", "active", "inactive"] as const;
export type PlatformWaFilter = (typeof PLATFORM_WA_FILTERS)[number];

export const PLATFORM_COMPANY_SORTS = [
    "created_at",
    "name",
    "order_count",
    "last_order_at",
] as const;
export type PlatformCompanySort = (typeof PLATFORM_COMPANY_SORTS)[number];

export type PlatformCompaniesFilter = {
    q: string;
    account: PlatformAccountFilter;
    datePreset: PlatformDatePreset;
    dateFrom: string | "all";
    dateTo: string | "all";
    planId: string | "all";
    subStatus: PlatformSubStatusFilter;
    onboarding: PlatformOnboardingFilter;
    wa: PlatformWaFilter;
    cidade: string;
    uf: string | "all";
    sort: PlatformCompanySort;
};

export function defaultCompaniesFilter(): PlatformCompaniesFilter {
    return {
        q: "",
        account: "all",
        planId: "all",
        subStatus: "all",
        onboarding: "all",
        wa: "all",
        cidade: "",
        uf: "all",
        sort: "created_at",
        ...applyDatePreset("all"),
    };
}

function isAccount(v: string): v is PlatformAccountFilter {
    return (PLATFORM_ACCOUNT_FILTERS as readonly string[]).includes(v);
}
function isSubStatus(v: string): v is PlatformSubStatusFilter {
    return v === "all" || (PLATFORM_SUB_STATUSES as readonly string[]).includes(v);
}
function isOnboarding(v: string): v is PlatformOnboardingFilter {
    return (PLATFORM_ONBOARDING_FILTERS as readonly string[]).includes(v);
}
function isWa(v: string): v is PlatformWaFilter {
    return (PLATFORM_WA_FILTERS as readonly string[]).includes(v);
}
function isSort(v: string): v is PlatformCompanySort {
    return (PLATFORM_COMPANY_SORTS as readonly string[]).includes(v);
}
function isDatePreset(v: string): v is PlatformDatePreset {
    return (PLATFORM_DATE_PRESETS as readonly string[]).includes(v);
}

function parseDateBound(
    sp: URLSearchParams,
    key: "date_from" | "date_to",
    fallback: string | "all"
): string | "all" {
    if (!sp.has(key)) return fallback;
    const raw = (sp.get(key) ?? "").trim();
    if (!raw || raw === "all") return "all";
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

export function parseCompaniesFilterFromSearchParams(
    sp: URLSearchParams
): PlatformCompaniesFilter {
    const defaults = defaultCompaniesFilter();
    const accountRaw = sp.get("account") ?? "all";
    const subRaw = sp.get("sub_status") ?? "all";
    const onboardingRaw = sp.get("onboarding") ?? "all";
    const waRaw = sp.get("wa") ?? "all";
    const sortRaw = sp.get("sort") ?? "created_at";
    const presetRaw = sp.get("date_preset") ?? "";

    let datePart: Pick<
        PlatformCompaniesFilter,
        "datePreset" | "dateFrom" | "dateTo"
    > = applyDatePreset(defaults.datePreset);

    if (presetRaw && isDatePreset(presetRaw) && presetRaw !== "custom") {
        datePart = applyDatePreset(presetRaw);
    } else if (presetRaw === "custom" || sp.has("date_from") || sp.has("date_to")) {
        const dateFrom = parseDateBound(sp, "date_from", defaults.dateFrom);
        const dateTo = parseDateBound(sp, "date_to", defaults.dateTo);
        const bothAll = dateFrom === "all" && dateTo === "all";
        datePart = {
            datePreset: bothAll ? "all" : "custom",
            dateFrom,
            dateTo,
        };
    }

    const ufRaw = (sp.get("uf") ?? "all").trim().toUpperCase();

    return {
        q: (sp.get("q") ?? "").trim(),
        account: isAccount(accountRaw) ? accountRaw : "all",
        planId: (sp.get("plan_id") ?? "all").trim() || "all",
        subStatus: isSubStatus(subRaw) ? subRaw : "all",
        onboarding: isOnboarding(onboardingRaw) ? onboardingRaw : "all",
        wa: isWa(waRaw) ? waRaw : "all",
        cidade: (sp.get("cidade") ?? "").trim(),
        uf: ufRaw && ufRaw !== "ALL" ? ufRaw.slice(0, 2) : "all",
        sort: isSort(sortRaw) ? sortRaw : "created_at",
        ...datePart,
    };
}

export function companiesFilterToSearchParams(
    f: PlatformCompaniesFilter
): URLSearchParams {
    const sp = new URLSearchParams();
    if (f.q) sp.set("q", f.q);
    sp.set("account", f.account);
    sp.set("date_preset", f.datePreset);
    sp.set("date_from", f.dateFrom);
    sp.set("date_to", f.dateTo);
    sp.set("plan_id", f.planId);
    sp.set("sub_status", f.subStatus);
    sp.set("onboarding", f.onboarding);
    sp.set("wa", f.wa);
    if (f.cidade) sp.set("cidade", f.cidade);
    sp.set("uf", f.uf);
    sp.set("sort", f.sort);
    return sp;
}

export function companiesFilterQueryString(f: PlatformCompaniesFilter): string {
    return companiesFilterToSearchParams(f).toString();
}

/** Options dropdown (pedidos/dashboard): todas as empresas, sem corte de data. */
export function companiesOptionsQueryString(): string {
    return companiesFilterQueryString(defaultCompaniesFilter());
}

export function companyCreatedAtBounds(f: PlatformCompaniesFilter): {
    fromIso: string | null;
    toIso: string | null;
} {
    return {
        fromIso:
            f.dateFrom !== "all" ? dateFromToIsoStart(f.dateFrom) : null,
        toIso: f.dateTo !== "all" ? dateToToIsoEnd(f.dateTo) : null,
    };
}
