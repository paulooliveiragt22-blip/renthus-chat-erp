import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

/**
 * GET /api/admin/orders/[id]/events
 * Timeline de auditoria (estorno full/partial, etc.).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCapability("orders.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const orderId = String(rawId ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data: order, error: ordErr } = await admin
        .from("orders")
        .select("id")
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

    const { data: events, error } = await admin
        .from("order_events")
        .select("id, event_type, payload, created_at, idempotency_key")
        .eq("company_id", companyId)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        events: (events ?? []).map((e) => ({
            id: e.id,
            event_type: e.event_type,
            payload: e.payload ?? {},
            created_at: e.created_at,
            idempotency_key: e.idempotency_key,
        })),
    });
}
