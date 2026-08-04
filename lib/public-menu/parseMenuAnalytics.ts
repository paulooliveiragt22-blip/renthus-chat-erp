import type { MenuAnalyticsResponse } from "@/src/types/contracts.public-menu";

function asInt(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function asStr(v: unknown): string {
    return typeof v === "string" ? v : String(v ?? "");
}

/** Converte jsonb snake_case do RPC para contrato camelCase. */
export function parseMenuAnalyticsRpc(raw: unknown): MenuAnalyticsResponse | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const daysRaw = Array.isArray(o.days) ? o.days : [];
    const topRaw = Array.isArray(o.top_products) ? o.top_products : [];
    const utmRaw = Array.isArray(o.utm_sources) ? o.utm_sources : [];

    return {
        from: asStr(o.from),
        to: asStr(o.to),
        pageViews: asInt(o.page_views),
        uniqueVisitors: asInt(o.unique_visitors),
        productViews: asInt(o.product_views),
        days: daysRaw.map((d) => {
            const row = (d ?? {}) as Record<string, unknown>;
            return {
                date: asStr(row.date),
                pageViews: asInt(row.page_views),
                uniqueVisitors: asInt(row.unique_visitors),
            };
        }),
        topProducts: topRaw.map((d) => {
            const row = (d ?? {}) as Record<string, unknown>;
            return {
                productId: asStr(row.product_id),
                name: asStr(row.name) || "Produto",
                views: asInt(row.views),
            };
        }),
        utmSources: utmRaw.map((d) => {
            const row = (d ?? {}) as Record<string, unknown>;
            return {
                utmSource: asStr(row.utm_source) || "(direto)",
                pageViews: asInt(row.page_views),
                uniqueVisitors: asInt(row.unique_visitors),
            };
        }),
    };
}

export function resolveAnalyticsRange(daysParam: string | null): {
    days: number;
    from: string;
    to: string;
} {
    const n = Number(daysParam);
    const days = n === 7 || n === 14 || n === 30 || n === 90 ? n : 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { days, from: from.toISOString(), to: to.toISOString() };
}
