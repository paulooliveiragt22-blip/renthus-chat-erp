import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/stats
 *
 * Retorna todos os dados necessários para o Dashboard:
 *  - salesTotal        : faturamento do dia (sales finalizadas, tabela sales)
 *  - ordersToday       : quantidade de pedidos hoje
 *  - activeOrders      : pedidos com status new | delivered
 *  - ticketMedio       : média por pedido hoje
 *  - waConversations   : threads com atividade nas últimas 24h
 *  - chartData         : array { hora, pedidos, total } – últimas 24h agrupadas por hora (BRL)
 *  - topProducts       : top 5 produtos (últimos 30 dias) – { name, qty }
 */

// BRL = UTC-3
const BRL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Converte timestamp ISO para hora BRL (0-23) */
function brlHour(isoStr: string): number {
    return new Date(new Date(isoStr).getTime() - BRL_OFFSET_MS).getUTCHours();
}

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;

    const now = new Date();

    // Hoje BRL: pegar data BRL atual e calcular meia-noite BRL em UTC
    const nowBRL = new Date(now.getTime() - BRL_OFFSET_MS);
    const todayStart = new Date(Date.UTC(
        nowBRL.getUTCFullYear(),
        nowBRL.getUTCMonth(),
        nowBRL.getUTCDate(),
        3, 0, 0, 0  // 03:00 UTC = 00:00 BRL (UTC-3)
    ));

    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── Consultas em paralelo ────────────────────────────────────────────────
    const [salesTodayRes, ordersCountRes, activeOrdersRes, orders24hRes, waThreadsRes, orderIds30dRes] =
        await Promise.all([

            // 1. Faturamento do dia — via orders (não cancelados)
            admin
                .from("orders")
                .select("total_amount")
                .eq("company_id", companyId)
                .gte("created_at", todayStart.toISOString())
                .neq("status", "canceled"),

            // 2. Quantidade de pedidos criados hoje (não cancelados)
            admin
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .gte("created_at", todayStart.toISOString())
                .neq("status", "canceled"),

            // 3. Pedidos ativos (new + delivered) — contagem pura
            admin
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .in("status", ["new", "delivered"]),

            // 4. Pedidos das últimas 24h — para o gráfico
            admin
                .from("orders")
                .select("id, total_amount, created_at")
                .eq("company_id", companyId)
                .gte("created_at", past24h.toISOString())
                .neq("status", "canceled")
                .order("created_at", { ascending: true }),

            // 5. Threads WhatsApp com atividade nas últimas 24h
            admin
                .from("whatsapp_threads")
                .select("id", { count: "exact", head: true })
                .eq("company_id", companyId)
                .gte("last_message_at", past24h.toISOString()),

            // 6. IDs dos pedidos dos últimos 30 dias (base para top produtos)
            admin
                .from("orders")
                .select("id")
                .eq("company_id", companyId)
                .gte("created_at", past30d.toISOString())
                .neq("status", "canceled"),
        ]);

    // ── Métricas simples ─────────────────────────────────────────────────────
    const salesTotal  = (salesTodayRes.data ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    const ordersCount = ordersCountRes.count ?? 0;
    const ticketMedio = ordersCount > 0 ? salesTotal / ordersCount : 0;
    const activeOrders    = activeOrdersRes.count ?? 0;
    const waConversations = waThreadsRes.count ?? 0;

    // ── Gráfico: 24 baldes horários (hora BRL) ───────────────────────────────
    const hourBuckets: Record<string, { pedidos: number; total: number }> = {};
    for (let i = 23; i >= 0; i--) {
        const t   = new Date(now.getTime() - i * 60 * 60 * 1000);
        const key = brlHour(t.toISOString()).toString().padStart(2, "0") + "h";
        hourBuckets[key] = { pedidos: 0, total: 0 };
    }
    for (const o of orders24hRes.data ?? []) {
        const key = brlHour(o.created_at).toString().padStart(2, "0") + "h";
        if (hourBuckets[key]) {
            hourBuckets[key].pedidos++;
            hourBuckets[key].total += Number(o.total_amount ?? 0);
        }
    }
    const chartData = Object.entries(hourBuckets).map(([hora, v]) => ({ hora, ...v }));

    // ── Top 5 produtos (últimos 30 dias) por produto_embalagem_id ────────────
    const orderIds = (orderIds30dRes.data ?? []).map((o: { id: string }) => o.id);

    let topProducts: Array<{ name: string; qty: number }> = [];

    if (orderIds.length > 0) {
        const { data: itemsRaw } = await admin
            .from("order_items")
            .select("produto_embalagem_id, product_name, quantity")
            .in("order_id", orderIds.slice(0, 500));

        // Agrupar por produto_embalagem_id (com fallback para product_name)
        const embQty: Record<string, number> = {};
        const embFallbackName: Record<string, string> = {};
        for (const it of itemsRaw ?? []) {
            const eid  = (it.produto_embalagem_id as string | null) ?? null;
            const key  = eid ?? `name:${it.product_name ?? "Item"}`;
            embQty[key] = (embQty[key] ?? 0) + Number(it.quantity ?? 1);
            if (!embFallbackName[key]) {
                embFallbackName[key] = (it.product_name as string) ?? "Item";
            }
        }

        // Top 5 IDs por quantidade
        const top5 = Object.entries(embQty)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Buscar nomes canônicos das embalagens com id real
        const realIds = top5.map(([k]) => k).filter(k => !k.startsWith("name:"));
        let canonicalNames: Record<string, string> = {};
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
        ordersToday:   ordersCount,
        activeOrders,
        ticketMedio,
        waConversations,
        chartData,
        topProducts,
    });
}
