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

        // limita para evitar intervalos gigantes no servidor (segurança)
        const maxDays = 366;
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysDiff = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
        if (daysDiff <= 0) return NextResponse.json({ error: "Intervalo inválido" }, { status: 400 });
        if (daysDiff > 3650) return NextResponse.json({ error: "Intervalo muito grande" }, { status: 400 }); // fail safe

        const startIso = isoStartOfDay(start);
        const endIso = isoEndOfDay(end);

        // Chama as RPCs (que retornam série com todos os dias)
        const ordersRes = await admin.rpc("renthus_reports_orders_daily", {
            p_company_id: companyId,
            p_start: startIso,
            p_end: endIso,
        });
        if (ordersRes.error) {
            console.error("orders rpc error", ordersRes.error);
            // fallback: buscar orders diretamente e agregar por dia (menos eficiente)
            const ordRes = await admin
                .from("orders")
                .select("created_at,total_amount", { count: undefined })
                .eq("company_id", companyId)
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(200000);

            if (ordRes.error) {
                console.error("orders fallback error", ordRes.error);
                return NextResponse.json({ error: ordRes.error.message }, { status: 500 });
            }
            // montar map de orders
            const ordersMap = new Map<string, { faturamento: number; orders: number }>();
            (ordRes.data ?? []).forEach((r: any) => {
                const dt = new Date(r.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                const cur = ordersMap.get(key) ?? { faturamento: 0, orders: 0 };
                const v = Number(r.total_amount ?? 0);
                cur.faturamento += isNaN(v) ? 0 : v;
                cur.orders += 1;
                ordersMap.set(key, cur);
            });

            // messages fallback
            const msgRes = await admin
                .from("whatsapp_messages")
                .select("created_at,thread_id", { count: undefined })
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(200000);

            if (msgRes.error) {
                console.error("messages fallback error", msgRes.error);
                return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
            }

            // precisamos contar apenas as mensagens cujo thread pertence à company
            const threadIds = Array.from(new Set((msgRes.data ?? []).map((m: any) => m.thread_id).filter(Boolean)));
            const threadsRes = await admin.from("whatsapp_threads").select("id,company_id").in("id", threadIds).limit(200000);
            const threadCompanyMap = new Map<string, string>();
            (threadsRes.data ?? []).forEach((t: any) => threadCompanyMap.set(t.id, t.company_id));

            const messagesMap = new Map<string, number>();
            (msgRes.data ?? []).forEach((m: any) => {
                const tid = m.thread_id;
                if (!tid) return;
                if (threadCompanyMap.get(tid) !== companyId) return;
                const dt = new Date(m.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                messagesMap.set(key, (messagesMap.get(key) ?? 0) + 1);
            });

            // montar resultados apenas para dias com lançamentos (omit zeros)
            const results: { date: string; faturamento: number; orders: number; messages: number }[] = [];
            ordersMap.forEach((o, k) => {
                const msgs = messagesMap.get(k) ?? 0;
                if ((o.faturamento || 0) !== 0 || (o.orders || 0) !== 0 || msgs !== 0) {
                    results.push({ date: k, faturamento: Number(o.faturamento.toFixed(2)), orders: o.orders, messages: msgs });
                }
            });
            // incluir dias com mensagens que não tem orders
            messagesMap.forEach((cnt, k) => {
                if (!ordersMap.has(k)) {
                    if (cnt !== 0) results.push({ date: k, faturamento: 0, orders: 0, messages: cnt });
                }
            });

            // ordenar por data
            results.sort((a, b) => a.date.localeCompare(b.date));
            return NextResponse.json({ ok: true, data: results });
        }

        // ordersRes.data and messagesRes.data expected
        const ordersData = (ordersRes.data ?? []) as any[];
        // chama messages
        const msgsRes = await admin.rpc("renthus_reports_messages_daily", {
            p_company_id: companyId,
            p_start: startIso,
            p_end: endIso,
        });
        if (msgsRes.error) {
            console.error("messages rpc error", msgsRes.error);
            // fallback similar to above: aggregate messages by join thread->company
            const msgRes = await admin
                .from("whatsapp_messages")
                .select("created_at,thread_id", { count: undefined })
                .gte("created_at", startIso)
                .lte("created_at", endIso)
                .limit(200000);

            if (msgRes.error) {
                console.error("messages fallback error", msgRes.error);
                return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
            }

            const threadIds = Array.from(new Set((msgRes.data ?? []).map((m: any) => m.thread_id).filter(Boolean)));
            const threadsRes = await admin.from("whatsapp_threads").select("id,company_id").in("id", threadIds).limit(200000);
            const threadCompanyMap = new Map<string, string>();
            (threadsRes.data ?? []).forEach((t: any) => threadCompanyMap.set(t.id, t.company_id));

            const messagesMap = new Map<string, number>();
            (msgRes.data ?? []).forEach((m: any) => {
                const tid = m.thread_id;
                if (!tid) return;
                if (threadCompanyMap.get(tid) !== companyId) return;
                const dt = new Date(m.created_at);
                const key = formatIsoDateOnly(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
                messagesMap.set(key, (messagesMap.get(key) ?? 0) + 1);
            });

            // combine with ordersData
            const oMap = new Map<string, { faturamento: number; orders: number }>();
            ordersData.forEach((o) => oMap.set(o.date, { faturamento: Number(o.faturamento ?? 0), orders: Number(o.orders ?? 0) }));

            const results: { date: string; faturamento: number; orders: number; messages: number }[] = [];
            oMap.forEach((o, k) => {
                const m = messagesMap.get(k) ?? 0;
                if ((o.faturamento || 0) !== 0 || (o.orders || 0) !== 0 || m !== 0) {
                    results.push({ date: k, faturamento: Number(o.faturamento.toFixed(2)), orders: o.orders, messages: m });
                }
            });
            messagesMap.forEach((cnt, k) => {
                if (!oMap.has(k) && cnt !== 0) results.push({ date: k, faturamento: 0, orders: 0, messages: cnt });
            });
            results.sort((a, b) => a.date.localeCompare(b.date));
            return NextResponse.json({ ok: true, data: results });
        }

        const msgsData = (msgsRes.data ?? []) as any[];

        const ordersMap = new Map<string, { faturamento: number; orders: number }>();
        ordersData.forEach((o) => ordersMap.set(o.date, { faturamento: Number(o.faturamento ?? 0), orders: Number(o.orders ?? 0) }));

        const messagesMap = new Map<string, number>();
        msgsData.forEach((m) => messagesMap.set(m.date, Number(m.count ?? 0)));

        // Monta resultados apenas com dias que têm qualquer lançamento (omit zeros)
        const results: { date: string; faturamento: number; orders: number; messages: number }[] = [];

        // iterar sobre chaves dos maps (união)
        const keys = new Set<string>();
        ordersMap.forEach((_v, k) => keys.add(k));
        messagesMap.forEach((_v, k) => keys.add(k));

        Array.from(keys)
            .sort()
            .forEach((k) => {
                const o = ordersMap.get(k) ?? { faturamento: 0, orders: 0 };
                const m = messagesMap.get(k) ?? 0;
                if ((o.faturamento || 0) !== 0 || (o.orders || 0) !== 0 || m !== 0) {
                    results.push({ date: k, faturamento: Number((o.faturamento || 0).toFixed(2)), orders: o.orders || 0, messages: m });
                }
            });

        return NextResponse.json({ ok: true, data: results });
    } catch (err: any) {
        console.error("reports/daily error:", err);
        return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
    }
}
