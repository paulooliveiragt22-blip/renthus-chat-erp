// app/api/reports/summary/route.ts
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

function isoStartOfDay(d: Date) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
}
function isoEndOfDay(d: Date) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) || {};
        const { start: startStr, end: endStr } = body;

        const access = await requireCompanyAccess();
        if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }
        const { companyId, admin } = access;

        // defaults: últimos 30 dias
        const now = new Date();
        const defaultEnd = now;
        const defaultStart = new Date(now);
        defaultStart.setDate(defaultStart.getDate() - 30);

        const start = startStr ? new Date(startStr) : defaultStart;
        const end = endStr ? new Date(endStr) : defaultEnd;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
        }

        const startIso = isoStartOfDay(start);
        const endIso = isoEndOfDay(end);

        // 1) total de pedidos (count)
        const ordersCountRes = await admin
            .from("orders")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .gte("created_at", startIso)
            .lte("created_at", endIso);

        if (ordersCountRes.error) {
            console.error("orders count error", ordersCountRes.error);
            return NextResponse.json({ error: ordersCountRes.error.message }, { status: 500 });
        }
        const totalOrders = ordersCountRes.count ?? 0;

        // 2) faturamento: soma de total_amount no intervalo
        const ordersAmountRes = await admin
            .from("orders")
            .select("total_amount")
            .eq("company_id", companyId)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .limit(100000);

        if (ordersAmountRes.error) {
            console.error("orders amount error", ordersAmountRes.error);
            return NextResponse.json({ error: ordersAmountRes.error.message }, { status: 500 });
        }

        const faturamento = (ordersAmountRes.data ?? []).reduce((acc: number, r: any) => {
            const v = Number(r?.total_amount ?? 0);
            return acc + (isNaN(v) ? 0 : v);
        }, 0);

        // 3) total de mensagens: contar whatsapp_messages através dos threads da company
        // (a coluna company_id NÃO existe em whatsapp_messages — company está em whatsapp_threads)
        let totalMessages = 0;
        const threadsRes = await admin
            .from("whatsapp_threads")
            .select("id", { count: undefined })
            .eq("company_id", companyId)
            .limit(100000);

        if (threadsRes.error) {
            console.error("whatsapp_threads fetch error", threadsRes.error);
            // proceed with 0 messages rather than failing the whole report
            totalMessages = 0;
        } else {
            const threadIds = (threadsRes.data ?? []).map((t: any) => t.id).filter(Boolean);
            if (threadIds.length === 0) {
                totalMessages = 0;
            } else {
                const messagesCountRes = await admin
                    .from("whatsapp_messages")
                    .select("id", { head: true, count: "exact" })
                    .in("thread_id", threadIds)
                    .gte("created_at", startIso)
                    .lte("created_at", endIso);

                if (messagesCountRes.error) {
                    console.error("messages count error", messagesCountRes.error);
                    totalMessages = 0;
                } else {
                    totalMessages = messagesCountRes.count ?? 0;
                }
            }
        }

        return NextResponse.json({
            ok: true,
            data: {
                faturamento: Number(faturamento.toFixed(2)),
                total_orders: Number(totalOrders || 0),
                total_messages: Number(totalMessages || 0),
                range: { start: startIso, end: endIso },
            },
        });
    } catch (err: any) {
        console.error("reports/summary error:", err);
        return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
    }
}
