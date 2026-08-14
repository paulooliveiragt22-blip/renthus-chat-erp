import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import {
    mergeChartWithOrders,
    queryHomeStats,
} from "@/src/financeiro/application/queryHomeStats";
import { zonedDayRange } from "@/src/financeiro/domain/dayBounds";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/stats
 *
 * M7 / F3: salesTotal = caixa 1.1 posted no dia civil da loja.
 * Ticket = recebido / vendas liquidadas (sales), não pedidos criados.
 * Gráfico = caixa por hora; pedidos entram só como dataset operacional.
 */

export async function GET() {
    const ctx = await requireCapability("dashboard.view");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const now = new Date();

    let money;
    try {
        money = await queryHomeStats(admin, companyId, now);
    } catch (e) {
        const msg = e instanceof Error ? e.message : "home_stats_failed";
        console.error("[dashboard/stats] queryHomeStats", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }

    const todayStart = zonedDayRange(money.day, money.timeZone).start;
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [ordersCountRes, activeOrdersRes, orders24hRes, waThreadsRes] = await Promise.all([
        admin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .gte("created_at", todayStart.toISOString())
            .neq("status", "canceled"),

        admin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .in("status", ["new", "preparing", "delivered"]),

        admin
            .from("orders")
            .select("id, created_at")
            .eq("company_id", companyId)
            .gte("created_at", past24h.toISOString())
            .neq("status", "canceled")
            .order("created_at", { ascending: true }),

        admin
            .from("whatsapp_threads")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .gte("last_message_at", past24h.toISOString()),
    ]);

    const chartData = mergeChartWithOrders(
        money.chartCashByHour,
        orders24hRes.data ?? [],
        money.timeZone,
        now
    );

    return NextResponse.json({
        salesTotal: money.salesTotal,
        arOpen: money.arOpen,
        ordersToday: ordersCountRes.count ?? 0,
        settledSalesToday: money.settledSalesToday,
        activeOrders: activeOrdersRes.count ?? 0,
        ticketMedio: money.ticketMedio,
        waConversations: waThreadsRes.count ?? 0,
        chartData,
        topProducts: money.topProducts,
        revenueSource: money.revenueSource, // finance_journals_1_1
        timeZone: money.timeZone,
        day: money.day,
    });
}
