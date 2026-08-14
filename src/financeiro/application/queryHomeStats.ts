import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyTimezone } from "@/src/financeiro/application/cashRevenue";
import { todayIsoInZone, zonedDayRange, zonedHour } from "@/src/financeiro/domain/dayBounds";
import { asMoney, roundMoney } from "@/src/financeiro/domain/money";
import { financeQuerySupabase } from "@/src/financeiro/adapters/supabase/financeQuery.supabase";

const CASH_SOURCES = new Set(["sale_payment", "recognize", "bill_settlement"]);
const SALE_SOURCES = new Set(["sale_payment", "recognize"]);

export type HomeChartPoint = {
    hora: string;
    caixa: number;
    pedidos: number;
};

export type HomeTopProduct = {
    name: string;
    qty: number;
};

export type HomeMoneyStats = {
    salesTotal: number;
    arOpen: number;
    settledSalesToday: number;
    ticketMedio: number;
    day: string;
    timeZone: string;
    revenueSource: "finance_journals_1_1";
    chartCashByHour: Array<{ hora: string; caixa: number }>;
    topProducts: HomeTopProduct[];
};

type ExtratoCashRow = {
    posted_at: string;
    source_type: string;
    status: string;
    sale_id: string | null;
    cash_amount: number | null;
};

export function ticketFromCashAndSales(recebido: number, settledSales: number): number {
    if (settledSales <= 0) return 0;
    return roundMoney(recebido / settledSales);
}

function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, "0")}h`;
}

function isCashLiquidation(row: ExtratoCashRow): boolean {
    return row.status === "posted" && CASH_SOURCES.has(row.source_type);
}

function isSettledSale(row: ExtratoCashRow): boolean {
    return (
        row.status === "posted" &&
        SALE_SOURCES.has(row.source_type) &&
        Boolean(row.sale_id) &&
        asMoney(row.cash_amount) !== 0
    );
}

/** Agrupa caixa 1.1 (v_fin_extrato.cash_amount) nas últimas 24h no fuso da loja. */
export function bucketCashByHour(
    rows: ExtratoCashRow[],
    timeZone: string,
    now: Date
): Array<{ hora: string; caixa: number }> {
    const buckets = new Map<string, number>();
    for (let i = 23; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 60 * 60 * 1000);
        buckets.set(hourLabel(zonedHour(t, timeZone)), 0);
    }
    const past24h = now.getTime() - 24 * 60 * 60 * 1000;
    for (const row of rows) {
        if (!isCashLiquidation(row)) continue;
        const posted = new Date(row.posted_at);
        if (posted.getTime() < past24h || posted.getTime() > now.getTime()) continue;
        const key = hourLabel(zonedHour(posted, timeZone));
        if (!buckets.has(key)) continue;
        buckets.set(key, roundMoney((buckets.get(key) ?? 0) + asMoney(row.cash_amount)));
    }
    return Array.from(buckets.entries()).map(([hora, caixa]) => ({ hora, caixa }));
}

export function countSettledSales(rows: ExtratoCashRow[]): number {
    const ids = new Set<string>();
    for (const row of rows) {
        if (!isSettledSale(row) || !row.sale_id) continue;
        ids.add(row.sale_id);
    }
    return ids.size;
}

/**
 * Números M7 da home: caixa 1.1 do dia civil, AR aberto, ticket sobre vendas liquidadas,
 * gráfico de caixa 24h e top produtos de `sales` (não `orders`).
 */
export async function queryHomeStats(
    admin: SupabaseClient,
    companyId: string,
    now = new Date()
): Promise<HomeMoneyStats> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const day = todayIsoInZone(now, timeZone);
    const dayBounds = zonedDayRange(day, timeZone);
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fetchFrom =
        dayBounds.start.getTime() < past24h.getTime() ? dayBounds.start : past24h;

    const [dash, extratoRes, salesRes] = await Promise.all([
        financeQuerySupabase.dashboard(
            admin,
            companyId,
            { from: dayBounds.start, toExclusive: dayBounds.endExclusive },
            timeZone
        ),
        admin
            .from("v_fin_extrato")
            .select("posted_at, source_type, status, sale_id, cash_amount")
            .eq("company_id", companyId)
            .gte("posted_at", fetchFrom.toISOString())
            .lt("posted_at", dayBounds.endExclusive.toISOString())
            .order("posted_at", { ascending: true })
            .limit(2000),
        admin
            .from("sales")
            .select("id")
            .eq("company_id", companyId)
            .gte("sold_at", past30d.toISOString())
            .lt("sold_at", now.toISOString())
            .neq("status", "canceled")
            .limit(2000),
    ]);

    if (extratoRes.error) throw new Error(extratoRes.error.message);
    if (salesRes.error) throw new Error(salesRes.error.message);

    const extratoRows = (extratoRes.data ?? []) as ExtratoCashRow[];
    const dayStartMs = dayBounds.start.getTime();
    const dayEndMs = dayBounds.endExclusive.getTime();
    const dayRows = extratoRows.filter((r) => {
        const t = new Date(r.posted_at).getTime();
        return t >= dayStartMs && t < dayEndMs;
    });

    const settledSalesToday = countSettledSales(dayRows);
    const salesTotal = dash.total;
    const chartCashByHour = bucketCashByHour(extratoRows, timeZone, now);

    const saleIds = (salesRes.data ?? []).map((s: { id: string }) => s.id);
    let topProducts: HomeTopProduct[] = [];
    if (saleIds.length > 0) {
        const { data: items, error: itemsErr } = await admin
            .from("sale_items")
            .select("product_name, qty")
            .eq("company_id", companyId)
            .in("sale_id", saleIds.slice(0, 500));
        if (itemsErr) throw new Error(itemsErr.message);

        const qtyByName: Record<string, number> = {};
        for (const it of items ?? []) {
            const name = String(it.product_name ?? "Item").trim() || "Item";
            qtyByName[name] = (qtyByName[name] ?? 0) + Number(it.qty ?? 0);
        }
        topProducts = Object.entries(qtyByName)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, qty]) => ({ name, qty: roundMoney(qty) }));
    }

    return {
        salesTotal,
        arOpen: dash.arOpen,
        settledSalesToday,
        ticketMedio: ticketFromCashAndSales(salesTotal, settledSalesToday),
        day,
        timeZone,
        revenueSource: "finance_journals_1_1",
        chartCashByHour,
        topProducts,
    };
}

export function mergeChartWithOrders(
    cashByHour: Array<{ hora: string; caixa: number }>,
    orderRows: Array<{ created_at: string; total_amount?: number | null }>,
    timeZone: string,
    _now: Date
): HomeChartPoint[] {
    const pedidosByHour = new Map<string, number>();
    for (const p of cashByHour) pedidosByHour.set(p.hora, 0);

    for (const o of orderRows) {
        const key = hourLabel(zonedHour(new Date(o.created_at), timeZone));
        if (!pedidosByHour.has(key)) continue;
        pedidosByHour.set(key, (pedidosByHour.get(key) ?? 0) + 1);
    }

    return cashByHour.map((p) => ({
        hora: p.hora,
        caixa: p.caixa,
        pedidos: pedidosByHour.get(p.hora) ?? 0,
    }));
}
