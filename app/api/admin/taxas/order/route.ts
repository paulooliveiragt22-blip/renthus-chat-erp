import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { applyOrderFees, listOrderFees } from "@/src/taxas/application/serviceFees";
import type { ApplyOrderFeeInput } from "@/src/taxas/domain/types";

export const runtime = "nodejs";

/**
 * GET /api/admin/taxas/order?order_id=
 * POST /api/admin/taxas/order — { order_id, fees: ApplyOrderFeeInput[] }
 * Substitui taxas não-delivery; delivery no payload sobrescreve a linha delivery.
 */
export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const orderId = new URL(req.url).searchParams.get("order_id")?.trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    try {
        const fees = await listOrderFees(ctx.admin, ctx.companyId, orderId);
        return NextResponse.json({ fees });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "list_failed" },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const rawFees = Array.isArray(body.fees) ? body.fees : [];
    const fees = rawFees as ApplyOrderFeeInput[];

    try {
        const result = await applyOrderFees(ctx.admin, ctx.companyId, orderId, fees);
        return NextResponse.json({ ok: true, fees: result });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "apply_failed" },
            { status: 500 }
        );
    }
}
