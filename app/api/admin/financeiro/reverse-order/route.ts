import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { reverseOrderSale } from "@/src/financeiro/application/reverseOrderSale";
import { financeRpcFailure } from "@/src/financeiro/application/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/financeiro/reverse-order
 * Estorno full: financeiro + estoque (rpc_admin_cancel_order).
 */
export async function POST(req: Request) {
    const ctx = await requireCapability("orders.status");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        reason?: string | null;
        reject_confirmation?: boolean;
    };

    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const reason = body.reason != null ? String(body.reason).trim() : "";
    if (!reason) {
        return NextResponse.json({ error: "reason_required" }, { status: 400 });
    }

    try {
        await reverseOrderSale(admin, {
            companyId,
            orderId,
            reason,
            rejectConfirmation: body.reject_confirmation === true,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "reverse_failed";
        return financeRpcFailure(msg);
    }

    try {
        const { pushMarketplaceOrderStatus } = await import(
            "@/src/marketplaces/services/pushMarketplaceOrderStatus"
        );
        await pushMarketplaceOrderStatus(admin, companyId, orderId, "canceled");
    } catch (err) {
        console.warn(
            "[financeiro/reverse-order] marketplace status push:",
            err instanceof Error ? err.message : err
        );
    }

    return NextResponse.json({ ok: true, order_id: orderId, status: "canceled" });
}
