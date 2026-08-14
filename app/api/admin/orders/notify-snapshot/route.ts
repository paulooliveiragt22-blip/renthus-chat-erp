import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

/**
 * Snapshot leve para alerta sonoro de pedidos novos (todos os sources/status).
 * GET → { ids: string[], latestAt: string | null }
 */
export async function GET() {
    const ctx = await requireCapability("orders.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select("id, created_at, source, confirmation_status, total_amount")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(40);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data ?? [];
    return NextResponse.json({
        ids: rows.map((r) => String(r.id)),
        latestAt: rows[0]?.created_at ? String(rows[0].created_at) : null,
        orders: rows.map((r) => ({
            id: String(r.id),
            createdAt: String(r.created_at),
            source: r.source == null ? null : String(r.source),
            confirmationStatus:
                r.confirmation_status == null ? null : String(r.confirmation_status),
            totalAmount: Number(r.total_amount ?? 0),
        })),
    });
}
