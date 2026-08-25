import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { reverseOrderOperation } from "@/src/financeiro/application/reverseOrderOperation";
import { financeRpcFailure } from "@/src/financeiro/application/http";

export const runtime = "nodejs";

type ReverseOrderBody = {
    order_id?: string;
    mode?: "full" | "partial";
    items?: Array<{ order_item_id?: string; qty?: number }>;
    include_delivery_fee?: boolean;
    include_service_fees?: boolean;
    reason?: string | null;
    idempotency_key?: string;
    reject_confirmation?: boolean;
};

/**
 * POST /api/admin/financeiro/reverse-order
 * Estorno operacional unificado: storno integral do journal + reemissão (partial) ou cancel (full).
 * Auth: owner/admin com financeiro.write (mesmo gate do Extrato).
 */
export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as ReverseOrderBody;

    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const mode = body.mode === "partial" ? "partial" : "full";
    const reason = body.reason != null ? String(body.reason).trim() : "";
    const idempotencyKey =
        body.idempotency_key?.trim() || `order:${orderId}:reverse:${mode}:${Date.now()}`;

    const items = Array.isArray(body.items)
        ? body.items
              .map((it) => ({
                  orderItemId: String(it.order_item_id ?? "").trim(),
                  qty: Number(it.qty),
              }))
              .filter((it) => it.orderItemId && Number.isFinite(it.qty) && it.qty > 0)
        : undefined;

    try {
        const result = await reverseOrderOperation(admin, {
            companyId,
            orderId,
            mode,
            items,
            includeDeliveryFee: body.include_delivery_fee === true,
            includeServiceFees: body.include_service_fees === true,
            reason: reason || null,
            idempotencyKey,
            rejectConfirmation: body.reject_confirmation === true,
        });

        if (reason) {
            await admin
                .from("orders")
                .update({ details: reason })
                .eq("id", orderId)
                .eq("company_id", companyId);
        }

        if (mode === "full") {
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
        }

        return NextResponse.json(result);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "reverse_failed";
        return financeRpcFailure(msg);
    }
}
