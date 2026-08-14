import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    civilRangeToUtcBounds,
    fetchReceivedIncome,
    loadCompanyTimezone,
} from "@/src/financeiro/application/cashRevenue";

export const runtime = "nodejs";

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

        const timeZone = await loadCompanyTimezone(admin, companyId);
        const fromDay = start.toISOString().slice(0, 10);
        const toDay = end.toISOString().slice(0, 10);
        const bounds = civilRangeToUtcBounds(fromDay, toDay, timeZone);

        const ordersCountRes = await admin
            .from("orders")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .gte("created_at", bounds.from.toISOString())
            .lt("created_at", bounds.toExclusive.toISOString());

        if (ordersCountRes.error) {
            console.error("orders count error", ordersCountRes.error);
            return NextResponse.json({ error: ordersCountRes.error.message }, { status: 500 });
        }
        const totalOrders = ordersCountRes.count ?? 0;

        const income = await fetchReceivedIncome(
            admin,
            companyId,
            { from: bounds.from, toExclusive: bounds.toExclusive },
            timeZone
        );
        const faturamento = income.total;

        let totalMessages = 0;
        const threadsRes = await admin
            .from("whatsapp_threads")
            .select("id")
            .eq("company_id", companyId)
            .limit(100000);

        if (threadsRes.error) {
            console.error("whatsapp_threads fetch error", threadsRes.error);
            totalMessages = 0;
        } else {
            const threadIds = (threadsRes.data ?? []).map((t: { id: string }) => t.id).filter(Boolean);
            if (threadIds.length === 0) {
                totalMessages = 0;
            } else {
                const messagesCountRes = await admin
                    .from("whatsapp_messages")
                    .select("id", { head: true, count: "exact" })
                    .in("thread_id", threadIds)
                    .gte("created_at", bounds.from.toISOString())
                    .lt("created_at", bounds.toExclusive.toISOString());

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
                range: { start: bounds.from.toISOString(), end: bounds.toExclusive.toISOString() },
                revenueSource: "finance_journals_1_1",
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        console.error("reports/summary error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
