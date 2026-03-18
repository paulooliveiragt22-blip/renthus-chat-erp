import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/stats
 *
 * Retorna todos os dados necessários para o Dashboard:
 *  - salesTotal        : faturamento do dia (pedidos não cancelados)
 *  - ordersToday       : quantidade de pedidos hoje
 *  - activeOrders      : pedidos com status new | delivered
 *  - ticketMedio       : média por pedido hoje
 *  - waConversations   : threads com atividade nas últimas 24h
 *  - chartData         : array { hora, pedidos, total } – últimas 24h agrupadas por hora
 *  - topProducts       : top 5 produtos (últimos 30 dias) – { name, qty }
 */
export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;

    const now        = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const past24h    = new Date(now.getTime() - 24  * 60 * 60 * 1000);
    const past30d    = new Date(now.getTime() - 30  * 24 * 60 * 60 * 1000);

    // ── Consultas em paralelo ────────────────────────────────────────────────
    const [ordersToday, activeOrdersRes, orders24hRes, waThreadsRes, orderIds30dRes] =
        await Promise.all([

            // 1. Pedidos de hoje (para faturamento e ticket médio)
            admin
                .from("orders")
                .select("id, total_amount")
                .eq("company_id", companyId)
                .gte("created_at", todayStart.toISOString())
                .neq("status", "canceled"),

            // 2. Pedidos ativos (new + delivered) — contagem pura
            admin
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .in("status", ["new", "delivered"]),

            // 3. Pedidos das últimas 24h — para o gráfico
            admin
                .from("orders")
                .select("id, total_amount, created_at")
                .eq("company_id", companyId)
                .gte("created_at", past24h.toISOString())
                .neq("status", "canceled")
                .order("created_at", { ascending: true }),

            // 4. Threads WhatsApp com atividade nas últimas 24h
            admin
                .from("whatsapp_threads")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .gte("last_message_at", past24h.toISOString()),

            // 5. IDs dos pedidos dos últimos 30 dias (base para top produtos)
            admin
                .from("orders")
                .select("id")
                .eq("company_id", companyId)
                .gte("created_at", past30d.toISOString())
                .neq("status", "canceled"),
        ]);

    // ── Métricas simples ─────────────────────────────────────────────────────
    const salesRows    = ordersToday.data ?? [];
    const salesTotal   = salesRows.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const ordersCount  = salesRows.length;
    const ticketMedio  = ordersCount > 0 ? salesTotal / ordersCount : 0;
    const activeOrders = activeOrdersRes.count ?? 0;
    const waConversations = waThreadsRes.count ?? 0;

    // ── Gráfico: 24 baldes horários ──────────────────────────────────────────
    // Constrói buckets das últimas 24h (hora local do servidor)
    const hourBuckets: Record<string, { pedidos: number; total: number }> = {};
    for (let i = 23; i >= 0; i--) {
        const t   = new Date(now.getTime() - i * 60 * 60 * 1000);
        const key = t.getHours().toString().padStart(2, "0") + "h";
        hourBuckets[key] = { pedidos: 0, total: 0 };
    }
    for (const o of orders24hRes.data ?? []) {
        const key = new Date(o.created_at).getHours().toString().padStart(2, "0") + "h";
        if (hourBuckets[key]) {
            hourBuckets[key].pedidos++;
            hourBuckets[key].total += Number(o.total_amount ?? 0);
        }
    }
    const chartData = Object.entries(hourBuckets).map(([hora, v]) => ({ hora, ...v }));

    // ── Top 5 produtos (últimos 30 dias) ─────────────────────────────────────
    const orderIds = (orderIds30dRes.data ?? []).map((o: { id: string }) => o.id);

    let topProducts: Array<{ name: string; qty: number }> = [];

    if (orderIds.length > 0) {
        // Busca itens somente dos pedidos da empresa — sem depender de JOIN nomeado
        const { data: itemsRaw } = await admin
            .from("order_items")
            .select("product_name, quantity")
            .in("order_id", orderIds.slice(0, 500)); // limita para segurança

        const productMap: Record<string, number> = {};
        for (const it of itemsRaw ?? []) {
            const name = (it.product_name as string) ?? "Item";
            productMap[name] = (productMap[name] ?? 0) + Number(it.quantity ?? 1);
        }
        topProducts = Object.entries(productMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, qty]) => ({ name, qty }));
    }

    return NextResponse.json({
        salesTotal,
        ordersToday:   ordersCount,
        activeOrders,
        ticketMedio,
        waConversations,
        chartData,
        topProducts,
    });
}
