import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { buildFilaOrderConfirmedMessage } from "@/lib/orders/buildOrderNotifyMessage";
import { notifyCustomerChannel } from "@/lib/orders/notifyCustomerChannel";

export const runtime = "nodejs";

async function loadOrderForNotify(
    admin: SupabaseClient,
    companyId: string,
    orderId: string
) {
    const { data } = await admin
        .from("orders")
        .select(
            "id, customer_id, total_amount, total, fulfillment_type, customers(phone_e164, phone)"
        )
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle();
    return data;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCapability("kitchen.view");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(rawId ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
    const action = String(body.action ?? "").trim();
    if (action === "confirm") {
        const orderBefore = await loadOrderForNotify(admin, companyId, id);

        const now = new Date().toISOString();
        const { error } = await admin
            .from("orders")
            .update({ confirmation_status: "confirmed", confirmed_at: now })
            .eq("id", id)
            .eq("company_id", companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        if (orderBefore?.customer_id) {
            const { data: settings } = await admin
                .from("company_settings")
                .select("delivery_est_minutes")
                .eq("company_id", companyId)
                .maybeSingle();

            const cust = orderBefore.customers as
                | { phone_e164?: string | null; phone?: string | null }
                | null
                | undefined;
            const phoneE164 =
                (cust?.phone_e164 as string | null)?.trim() ||
                (cust?.phone as string | null)?.trim() ||
                "";

            const shortId = `#${id.replaceAll("-", "").slice(-6).toUpperCase()}`;
            const text = buildFilaOrderConfirmedMessage({
                orderCode: shortId,
                grandTotal: Number(orderBefore.total_amount ?? orderBefore.total ?? 0),
                fulfillmentType: orderBefore.fulfillment_type as string | null,
                etaMin:
                    settings?.delivery_est_minutes != null
                        ? Number(settings.delivery_est_minutes)
                        : null,
            });

            await notifyCustomerChannel({
                admin,
                companyId,
                customerId: String(orderBefore.customer_id),
                phoneE164,
                text,
            });
        }

        return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
        const orderBefore = await loadOrderForNotify(admin, companyId, id);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";

        const { error } = await admin.rpc("rpc_admin_cancel_order", {
            p_company_id: companyId,
            p_order_id: id,
            p_reject_confirmation: true,
        });
        if (error) {
            const msg = error.message ?? "cancel_failed";
            if (/settlement_conflict/i.test(msg)) {
                return NextResponse.json({ error: "settlement_conflict" }, { status: 409 });
            }
            return NextResponse.json({ error: msg }, { status: 500 });
        }

        if (orderBefore?.customer_id) {
            const cust = orderBefore.customers as
                | { phone_e164?: string | null; phone?: string | null }
                | null
                | undefined;
            const phoneE164 =
                (cust?.phone_e164 as string | null)?.trim() ||
                (cust?.phone as string | null)?.trim() ||
                "";
            const shortId = `#${id.replaceAll("-", "").slice(-6).toUpperCase()}`;
            const text =
                `❌ Infelizmente seu pedido não pôde ser confirmado.\n\n` +
                (reason ? `Motivo: ${reason}\n\n` : "") +
                `Entre em contato conosco para mais informações.`;

            await notifyCustomerChannel({
                admin,
                companyId,
                customerId: String(orderBefore.customer_id),
                phoneE164,
                text,
            });
        }

        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
