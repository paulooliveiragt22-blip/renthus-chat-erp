// app/api/orders/status/route.ts
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

        // busca apenas status e total_amount para agregação
        const { data: orders, error } = await admin
            .from("orders")
            .select("status, total_amount")
            .eq("company_id", companyId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const summary: Record<string, { count: number; revenue: number }> = {};
        for (const o of orders || []) {
            const s = String(o.status ?? "unknown");
            if (!summary[s]) summary[s] = { count: 0, revenue: 0 };
            summary[s].count += 1;
            summary[s].revenue += Number(o.total_amount || 0);
        }

        return NextResponse.json({ summary });
    } catch (e: any) {
        return NextResponse.json({ error: e.message ?? "unexpected" }, { status: 500 });
    }
}
