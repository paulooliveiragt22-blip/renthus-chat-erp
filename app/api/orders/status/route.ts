// app/api/orders/status/route.ts
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function GET() {
    try {
        const ctx = await requireCapability("orders.read");
        if (!ctx.ok) {
            return NextResponse.json({ error: ctx.error }, { status: ctx.status });
        }
        const { admin, companyId } = ctx;

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
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "unexpected";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
