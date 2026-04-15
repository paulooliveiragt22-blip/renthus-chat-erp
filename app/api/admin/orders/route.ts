import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { orderItemsForAdminRpc } from "@/lib/server/orders/rpcAdminOrderItems";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select(`id, status, channel, source, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address ), order_items ( product_name, quantity, unit_price, line_total )`)
        .eq("company_id", companyId)
        .neq("confirmation_status", "pending_confirmation")
        .order("created_at", { ascending: false })
        .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data ?? [] });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        details?: string | null;
        payment_method?: string | null;
        paid?: boolean;
        change_for?: number | null;
        customer_id?: string;
        delivery_fee?: number;
        total_amount?: number;
        driver_id?: string | null;
    };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.status != null) patch.status = String(body.status);
    if (body.details !== undefined) patch.details = body.details;
    if (body.payment_method !== undefined) patch.payment_method = body.payment_method;
    if (body.paid !== undefined) patch.paid = !!body.paid;
    if (body.change_for !== undefined) patch.change_for = body.change_for;
    if (body.customer_id !== undefined) patch.customer_id = String(body.customer_id);
    if (body.delivery_fee !== undefined) patch.delivery_fee = Number(body.delivery_fee ?? 0);
    if (body.total_amount !== undefined) patch.total_amount = Number(body.total_amount ?? 0);
    if (body.driver_id !== undefined) patch.driver_id = body.driver_id || null;

    if (patch.status === "canceled") {
        const { error: cErr } = await admin.rpc("rpc_admin_cancel_order", {
            p_company_id: companyId,
            p_order_id: id,
            p_reject_confirmation: false,
        });
        if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
        delete patch.status;
    }

    if (body.driver_id !== undefined) {
        const driverUuid =
            body.driver_id != null && String(body.driver_id).trim() !== ""
                ? String(body.driver_id).trim()
                : null;
        const { error: dErr } = await admin.rpc("rpc_admin_assign_driver", {
            p_company_id: companyId,
            p_order_id: id,
            p_driver_id: driverUuid,
        });
        if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
        delete patch.driver_id;
    }

    if (Object.keys(patch).length > 0) {
        const { data, error } = await admin
            .from("orders")
            .update(patch)
            .eq("id", id)
            .eq("company_id", companyId)
            .select("id")
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, order: data });
    }

    const { data: row } = await admin.from("orders").select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
    if (!row) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, order: row });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        customer_id?: string;
        channel?: string;
        status?: string;
        confirmation_status?: string;
        payment_method?: string;
        paid?: boolean;
        change_for?: number | null;
        delivery_fee?: number;
        total_amount?: number;
        details?: string | null;
        driver_id?: string | null;
        source?: string | null;
        items?: Array<Record<string, unknown>>;
    };

    const customerId = String(body.customer_id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
        return NextResponse.json({ error: "items_required" }, { status: 400 });
    }

    const rpcItems = orderItemsForAdminRpc(items);
    const driverId = String(body.driver_id ?? "").trim() || null;

    const { data: orderId, error: rpcErr } = await admin.rpc("rpc_admin_upsert_order_with_items", {
        p_company_id: companyId,
        p_order_id: null,
        p_customer_id: customerId,
        p_channel: body.channel ?? "admin",
        p_status: body.status ?? "new",
        p_confirmation_status: body.confirmation_status ?? "confirmed",
        p_payment_method: body.payment_method ?? "pix",
        p_paid: !!body.paid,
        p_change_for: body.change_for ?? null,
        p_delivery_fee: Number(body.delivery_fee ?? 0),
        p_details: body.details != null ? String(body.details) : null,
        p_driver_id: driverId,
        p_source: body.source != null && String(body.source).trim() !== "" ? String(body.source).trim() : null,
        p_items: rpcItems,
    });

    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    if (!orderId) return NextResponse.json({ error: "order_create_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, order_id: orderId as string });
}
