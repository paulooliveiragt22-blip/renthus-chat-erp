import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    loadCompanyTimezone,
    receivedIncomeToday,
} from "@/lib/server/financeiro/receivedIncome";
import { zonedDayRange, zonedHour } from "@/lib/server/financeiro/dayBounds";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/stats
 *
 * Faturamento (salesTotal) = soma de financial_entries income/received no dia civil da loja (M7).
 * Pedidos do dia / ativos / gráfico / top produtos permanecem operacionais sobre orders.
 */

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const now = new Date();
    const timeZone = await loadCompanyTimezone(admin, companyId);

    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const incomeToday = await receivedIncomeToday(admin, companyId, now);
    const todayStart = zonedDayRange(incomeToday.day, timeZone).start;

    const [ordersCountRes, activeOrdersRes, orders24hRes, waThreadsRes, orderIds30dRes] =
        await Promise.all([
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
                .select("id, total_amount, created_at")
                .eq("company_id", companyId)
                .gte("created_at", past24h.toISOString())
                .neq("status", "canceled")
                .order("created_at", { ascending: true }),

            admin
                .from("whatsapp_threads")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .gte("last_message_at", past24h.toISOString()),

            admin
                .from("orders")
                .select("id")
                .eq("company_id", companyId)
                .gte("created_at", past30d.toISOString())
                .neq("status", "canceled"),
        ]);

    const salesTotal = incomeToday.total;
    const ordersCount = ordersCountRes.count ?? 0;
    // Ticket médio operacional do dia: receita recebida / pedidos criados hoje (se houver)
    const ticketMedio = ordersCount > 0 ? salesTotal / ordersCount : salesTotal;
    const activeOrders = activeOrdersRes.count ?? 0;
    const waConversations = waThreadsRes.count ?? 0;

    const hourBuckets: Record<string, { pedidos: number; total: number }> = {};
    for (let i = 23; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 60 * 60 * 1000);
        const key = zonedHour(t, timeZone).toString().padStart(2, "0") + "h";
        if (!hourBuckets[key]) hourBuckets[key] = { pedidos: 0, total: 0 };
    }
    for (const o of orders24hRes.data ?? []) {
        const key = zonedHour(new Date(o.created_at), timeZone).toString().padStart(2, "0") + "h";
        if (!hourBuckets[key]) hourBuckets[key] = { pedidos: 0, total: 0 };
        hourBuckets[key].pedidos++;
        hourBuckets[key].total += Number(o.total_amount ?? 0);
    }
    const chartData = Object.entries(hourBuckets).map(([hora, v]) => ({ hora, ...v }));

    const orderIds = (orderIds30dRes.data ?? []).map((o: { id: string }) => o.id);
    let topProducts: Array<{ name: string; qty: number }> = [];

    if (orderIds.length > 0) {
        const { data: itemsRaw } = await admin
            .from("order_items")
            .select("produto_embalagem_id, product_name, quantity")
            .in("order_id", orderIds.slice(0, 500));

        const embQty: Record<string, number> = {};
        const embFallbackName: Record<string, string> = {};
        for (const it of itemsRaw ?? []) {
            const eid = (it.produto_embalagem_id as string | null) ?? null;
            const key = eid ?? `name:${it.product_name ?? "Item"}`;
            embQty[key] = (embQty[key] ?? 0) + Number(it.quantity ?? 1);
            if (!embFallbackName[key]) {
                embFallbackName[key] = (it.product_name as string) ?? "Item";
            }
        }

        const top5 = Object.entries(embQty)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const realIds = top5.map(([k]) => k).filter((k) => !k.startsWith("name:"));
        const canonicalNames: Record<string, string> = {};
        if (realIds.length > 0) {
            const { data: embRows } = await admin
                .from("view_pdv_produtos")
                .select("id, product_name")
                .in("id", realIds);
            for (const r of embRows ?? []) {
                canonicalNames[r.id] = r.product_name;
            }
        }

        topProducts = top5.map(([key, qty]) => ({
            name: canonicalNames[key] ?? embFallbackName[key] ?? key,
            qty,
        }));
    }

    return NextResponse.json({
        salesTotal,
        ordersToday: ordersCount,
        activeOrders,
        ticketMedio,
        waConversations,
        chartData,
        topProducts,
        revenueSource: "financial_entries_received",
        timeZone,
    });
}
