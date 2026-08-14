import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    civilRangeToUtcBounds,
    fetchReceivedIncome,
    loadCompanyTimezone,
} from "@/src/financeiro/application/cashRevenue";

export const runtime = "nodejs";

function formatIsoDateOnly(d: Date) {
    return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) || {};
        const { start: startStr, end: endStr } = body;

        const access = await requireCapability("financeiro.read");
        if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }
        const { companyId, admin } = access;

        const feat = await requirePlanFeature(admin, companyId, "financeiro_full");
        if (!feat.ok) return feat.response;

        const now = new Date();
        const defaultEnd = now;
        const defaultStart = new Date(now);
        defaultStart.setDate(defaultStart.getDate() - 30);

        const start = startStr ? new Date(startStr) : defaultStart;
        const end = endStr ? new Date(endStr) : defaultEnd;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
        }

        const msPerDay = 24 * 60 * 60 * 1000;
        const daysDiff = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
        if (daysDiff <= 0) return NextResponse.json({ error: "Intervalo inválido" }, { status: 400 });
        if (daysDiff > 3650) return NextResponse.json({ error: "Intervalo muito grande" }, { status: 400 });

        const timeZone = await loadCompanyTimezone(admin, companyId);
        const fromDay = start.toISOString().slice(0, 10);
        const toDay = end.toISOString().slice(0, 10);
        const bounds = civilRangeToUtcBounds(fromDay, toDay, timeZone);

        const income = await fetchReceivedIncome(
            admin,
            companyId,
            { from: bounds.from, toExclusive: bounds.toExclusive },
            timeZone
        );

        const ordersRes = await admin.rpc("renthus_reports_orders_daily", {
            p_company_id: companyId,
            p_start: bounds.from.toISOString(),
            p_end: bounds.toExclusive.toISOString(),
        });

        const ordersMap = new Map<string, number>();
        if (!ordersRes.error) {
            for (const o of (ordersRes.data ?? []) as Array<{ date?: string; orders?: number }>) {
                ordersMap.set(String(o.date), Number(o.orders ?? 0));
            }
        } else {
            const ordRes = await admin
                .from("orders")
                .select("created_at")
                .eq("company_id", companyId)
                .gte("created_at", bounds.from.toISOString())
                .lt("created_at", bounds.toExclusive.toISOString())
                .limit(200000);
            if (ordRes.error) {
                return NextResponse.json({ error: ordRes.error.message }, { status: 500 });
            }
            for (const r of ordRes.data ?? []) {
                const dt = new Date(r.created_at);
                const key = formatIsoDateOnly(
                    new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
                );
                ordersMap.set(key, (ordersMap.get(key) ?? 0) + 1);
            }
        }

        const msgsRes = await admin.rpc("renthus_reports_messages_daily", {
            p_company_id: companyId,
            p_start: bounds.from.toISOString(),
            p_end: bounds.toExclusive.toISOString(),
        });
        const messagesMap = new Map<string, number>();
        if (!msgsRes.error) {
            for (const m of (msgsRes.data ?? []) as Array<{ date?: string; count?: number }>) {
                messagesMap.set(String(m.date), Number(m.count ?? 0));
            }
        }

        const cashMap = new Map<string, number>();
        for (const d of income.byDay) {
            cashMap.set(d.day, d.amount);
        }

        const keys = new Set<string>();
        cashMap.forEach((_v, k) => keys.add(k));
        ordersMap.forEach((_v, k) => keys.add(k));
        messagesMap.forEach((_v, k) => keys.add(k));

        const results: { date: string; faturamento: number; orders: number; messages: number }[] = [];
        Array.from(keys)
            .sort((a, b) => a.localeCompare(b, "en-CA"))
            .forEach((k) => {
                const faturamento = cashMap.get(k) ?? 0;
                const orders = ordersMap.get(k) ?? 0;
                const messages = messagesMap.get(k) ?? 0;
                if (faturamento !== 0 || orders !== 0 || messages !== 0) {
                    results.push({
                        date: k,
                        faturamento: Number(faturamento.toFixed(2)),
                        orders,
                        messages,
                    });
                }
            });

        return NextResponse.json({ ok: true, data: results, revenueSource: "finance_journals_1_1" });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        console.error("reports/daily error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
