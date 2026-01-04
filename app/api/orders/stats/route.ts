// app/api/orders/stats/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyIdFromCookie } from "@/lib/workspace/getCurrentCompanyId";

export const runtime = "nodejs";

export async function GET() {
    try {
        const companyId = getCurrentCompanyIdFromCookie();
        if (!companyId) {
            return NextResponse.json({ error: "No workspace selected" }, { status: 400 });
        }

        const admin = createAdminClient();

        // Seleciona pedidos da company (campos mínimos)
        const { data: orders, error } = await admin
            .from("orders")
            .select("id, status, total_amount, created_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Agregar counts por status e soma de receita total
        const counts: Record<string, number> = {};
        let totalRevenue = 0;
        for (const o of orders || []) {
            const status = String(o.status ?? "unknown");
            counts[status] = (counts[status] || 0) + 1;
            totalRevenue += Number(o.total_amount || 0);
        }

        // Série diária (últimos 30 dias)
        const days = 30;
        const now = new Date();
        const dayBuckets: Record<string, { date: string; revenue: number; orders: number }> = {};

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            d.setUTCDate(d.getUTCDate() - i);
            const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
            dayBuckets[key] = { date: key, revenue: 0, orders: 0 };
        }

        for (const o of orders || []) {
            const created = o.created_at ? new Date(o.created_at) : null;
            if (!created) continue;
            const key = created.toISOString().slice(0, 10);
            if (dayBuckets[key]) {
                dayBuckets[key].orders += 1;
                dayBuckets[key].revenue += Number(o.total_amount || 0);
            }
        }

        const daily = Object.values(dayBuckets);

        return NextResponse.json({
            stats: { counts, totalRevenue },
            daily,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message ?? "unexpected" }, { status: 500 });
    }
}
