// app/api/reports/daily/route.ts
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

function isoStartOfDay(d: Date) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
}
function isoEndOfDay(d: Date) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();
}

function formatIsoDateOnly(d: Date) {
    return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) || {};
        const { start: startStr, end: endStr } = body;

        // valida company / user / role
        const access = await requireCompanyAccess();
        if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }
        const { companyId, admin } = access;

        // defaults
        const now = new Date();
        const defaultEnd = now;
        const defaultStart = new Date(now);
        defaultStart.setDate(defaultStart.getDate() - 30);

        const start = startStr ? new Date(startStr) : defaultStart;
        const end = endStr ? new Date(endStr) : defaultEnd;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
        }

        // cap max days to avoid queries gigantes (ex: 365)
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysDiff = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
        if (daysDiff <= 0) {
            return NextResponse.json({ error: "Intervalo inválido" }, { status: 400 });
        }
        if (daysDiff > 366) {
            return NextResponse.json({ error: "Intervalo muito grande (máx: 366 dias)" }, { status: 400 });
        }

        // Para cada dia, vamos buscar agregados por created_at
        const results: { date: string; faturamento: number; orders: number; messages: number }[] = [];

        // Estratégia: fazer 3 queries por tabela para cada dia (pode ser otimizada por SUM/GROUP BY no DB)
        // Preferível: usar SUM / GROUP BY no banco. Aqui faço SUM/GROUP BY para orders; para messages e count também.
        // 1) Fetch faturamento + orders por dia usando uma query com group by no banco:
        const startIso = isoStartOfDay(start);
        const endIso = isoEndOfDay(end);

        // Supabase / Postgres: agrupar por day
        // Usamos SQL bruto via rpc (se admin.from().rpc não existir, fazemos select simples)
        // Simples: criar um SQL com to_char(created_at, 'YYYY-MM-DD') or date_trunc
        const ordersDailyRes = await admin.rpc("renthus_reports_orders_daily", {
            p_company_id: companyId,
            p_start: startIso,
            p_end: endIso,
        });

        // Caso a função RPC não exista no banco, fazemos fallback para consultas JS (menos eficiente)
        if (ordersDailyRes.error) {
            // fallback: fetch all orders in range and aggregate in JS
            const ordRes = await admin
                .from("orders")
                .select("created_at,total_amount", { count: undefined })
                .eq("company_id", companyId)
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(100000);

            if (ordRes.error) {
                console.error("orders fetch error", ordRes.error);
                return NextResponse.json({ error: ordRes.error.message }, { status: 500 });
            }

            // build map date -> { faturamento, orders }
            const map = new Map<string, { faturamento: number; orders: number }>();
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                map.set(formatIsoDateOnly(new Date(d)), { faturamento: 0, orders: 0 });
            }

            (ordRes.data ?? []).forEach((r: any) => {
                const dt = new Date(r.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                const cur = map.get(key) ?? { faturamento: 0, orders: 0 };
                const v = Number(r.total_amount ?? 0);
                cur.faturamento += isNaN(v) ? 0 : v;
                cur.orders += 1;
                map.set(key, cur);
            });

            // messages
            const msgRes = await admin
                .from("whatsapp_messages")
                .select("created_at", { count: undefined })
                .eq("company_id", companyId)
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(200000);

            if (msgRes.error) {
                console.error("messages fetch error", msgRes.error);
                return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
            }

            (msgRes.data ?? []).forEach((m: any) => {
                const dt = new Date(m.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                const cur = map.get(key) ?? { faturamento: 0, orders: 0 };
                // we'll store messages in separate map later; to keep simple, attach messages using a separate map
                map.set(key, cur);
            });

            // build messages map
            const messagesMap = new Map<string, number>();
            (msgRes.data ?? []).forEach((m: any) => {
                const dt = new Date(m.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                messagesMap.set(key, (messagesMap.get(key) ?? 0) + 1);
            });

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = formatIsoDateOnly(new Date(d));
                const o = map.get(key) ?? { faturamento: 0, orders: 0 };
                results.push({
                    date: key,
                    faturamento: Number((o.faturamento || 0).toFixed(2)),
                    orders: o.orders || 0,
                    messages: messagesMap.get(key) ?? 0,
                });
            }

            return NextResponse.json({ ok: true, data: results });
        }

        // Se chegamos aqui e RPC existiu, assumimos que ordersDailyRes.data tem rows: [{date, faturamento, orders}]
        // Precisamos juntar messages diários também. Tentar fazer group by messages:
        const messagesDailyRes = await admin.rpc("renthus_reports_messages_daily", {
            p_company_id: companyId,
            p_start: startIso,
            p_end: endIso,
        });

        if (messagesDailyRes.error) {
            // fallback a consulta simples similar ao acima (mas aqui assumiremos que ordersDailyRes possui os dados)
            const ordersMap = new Map<string, { faturamento: number; orders: number }>();
            (ordersDailyRes.data ?? []).forEach((r: any) => {
                ordersMap.set(r.date, { faturamento: Number(r.faturamento ?? 0), orders: Number(r.orders ?? 0) });
            });

            // fetch messages and aggregate
            const msgRes = await admin
                .from("whatsapp_messages")
                .select("created_at", { count: undefined })
                .eq("company_id", companyId)
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(200000);

            if (msgRes.error) {
                console.error("messages fetch error", msgRes.error);
                return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
            }

            const messagesMap = new Map<string, number>();
            (msgRes.data ?? []).forEach((m: any) => {
                const dt = new Date(m.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                messagesMap.set(key, (messagesMap.get(key) ?? 0) + 1);
            });

            // build results for each day in range
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = formatIsoDateOnly(new Date(d));
                const o = ordersMap.get(key) ?? { faturamento: 0, orders: 0 };
                results.push({
                    date: key,
                    faturamento: Number((o.faturamento || 0).toFixed(2)),
                    orders: o.orders || 0,
                    messages: messagesMap.get(key) ?? 0,
                });
            }

            return NextResponse.json({ ok: true, data: results });
        }

        // Se as RPCs existirem, combinar os dois resultados
        const ordersData = (ordersDailyRes.data ?? []) as any[];
        const messagesData = (messagesDailyRes.data ?? []) as any[];

        const messagesMap = new Map<string, number>();
        messagesData.forEach((m) => messagesMap.set(m.date, Number(m.count ?? 0)));

        const ordersMap = new Map<string, { faturamento: number; orders: number }>();
        ordersData.forEach((o) => ordersMap.set(o.date, { faturamento: Number(o.faturamento ?? 0), orders: Number(o.orders ?? 0) }));

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = formatIsoDateOnly(new Date(d));
            const o = ordersMap.get(key) ?? { faturamento: 0, orders: 0 };
            results.push({
                date: key,
                faturamento: Number((o.faturamento || 0).toFixed(2)),
                orders: o.orders || 0,
                messages: messagesMap.get(key) ?? 0,
            });
        }

        return NextResponse.json({ ok: true, data: results });
    } catch (err: any) {
        console.error("reports/daily error:", err);
        return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
    }
}
