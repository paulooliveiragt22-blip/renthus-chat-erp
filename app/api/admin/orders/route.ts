import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { orderItemsForAdminRpc } from "@/lib/server/orders/rpcAdminOrderItems";
import { enqueuePreparingNotify } from "@/lib/orders/enqueuePreparingNotify";
import {
    scheduleOutboundAfterEnqueue,
    scheduleOutboundAfterEnqueueLookup,
} from "@/lib/queue/afterEnqueue";
import { recognizeOrderSale } from "@/src/financeiro/application/recognizeOrderSale";
import { reverseOrderSale } from "@/src/financeiro/application/reverseOrderSale";
import { financeRpcFailure } from "@/src/financeiro/application/http";
import {
    assertFulfillmentAllowed,
    loadFulfillmentPolicy,
    parseFulfillmentType,
    PICKUP_ADDRESS_LABEL,
    type FulfillmentType,
} from "@/lib/delivery/fulfillment";

export const runtime = "nodejs";

type SetStatusRpcResult = {
    ok?: boolean;
    order_id?: string;
    status?: string;
    previous_status?: string;
    changed?: boolean;
    fulfillment_type?: string;
    customer_id?: string | null;
    order_code?: string;
};

const ORDER_LIST_SELECT =
    "id, status, channel, source, driver_id, total_amount, delivery_fee, delivery_address, payment_method, paid, change_for, created_at, details, notes, fulfillment_type, customers ( name, phone, address )";

const ORDER_ITEM_PREVIEW_SELECT =
    "order_id, product_name, quantity, unit_price, line_total";

type OrderStats = {
    total: number;
    new: number;
    preparing: number;
    delivered: number;
    finalized: number;
    canceled: number;
};

type OrderSummary = {
    novosQtd: number;
    novosTotal: number;
    prepQtd: number;
    entregaQtd: number;
    finalHojeQtd: number;
    finalHojeTotal: number;
};

function emptyStats(): OrderStats {
    return { total: 0, new: 0, preparing: 0, delivered: 0, finalized: 0, canceled: 0 };
}

function emptySummary(): OrderSummary {
    return {
        novosQtd: 0,
        novosTotal: 0,
        prepQtd: 0,
        entregaQtd: 0,
        finalHojeQtd: 0,
        finalHojeTotal: 0,
    };
}

function computeStatsAndSummary(
    rows: Array<{ status?: string | null; total_amount?: number | null; created_at?: string | null }>
): { stats: OrderStats; summary: OrderSummary } {
    const stats = emptyStats();
    const summary = emptySummary();
    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);

    for (const o of rows) {
        const st = String(o.status ?? "");
        const tot = Number(o.total_amount ?? 0);
        stats.total += 1;
        if (st === "new" || st === "preparing" || st === "delivered" || st === "finalized" || st === "canceled") {
            stats[st] += 1;
        }

        if (st === "new") {
            summary.novosQtd += 1;
            summary.novosTotal += tot;
        } else if (st === "preparing") {
            summary.prepQtd += 1;
        } else if (st === "delivered") {
            summary.entregaQtd += 1;
        } else if (st === "finalized" && o.created_at && new Date(o.created_at) >= startDay) {
            summary.finalHojeQtd += 1;
            summary.finalHojeTotal += tot;
        }
    }
    return { stats, summary };
}

export async function GET(req: Request) {
    const ctx = await requireCapability("orders.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const url = new URL(req.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20)
    );
    const statusFilter = String(url.searchParams.get("status") ?? "all").trim().toLowerCase();
    const q = String(url.searchParams.get("q") ?? "").trim();

    // Agregados leves (sem join / sem itens) — alimentam chips e cards do topo.
    const { data: aggRows, error: aggErr } = await admin
        .from("orders")
        .select("status, total_amount, created_at")
        .eq("company_id", companyId)
        .neq("confirmation_status", "pending_confirmation");
    if (aggErr) return NextResponse.json({ error: aggErr.message }, { status: 500 });
    const { stats, summary } = computeStatsAndSummary(aggRows ?? []);

    let customerIds: string[] | null = null;
    if (q.length >= 2) {
        const safe = q.replaceAll(/[%_,]/g, " ").trim();
        const { data: custs, error: custErr } = await admin
            .from("customers")
            .select("id")
            .eq("company_id", companyId)
            .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,address.ilike.%${safe}%`)
            .limit(150);
        if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });
        customerIds = (custs ?? []).map((c) => String((c as { id: string }).id));
        if (customerIds.length === 0) {
            return NextResponse.json({
                orders: [],
                meta: {
                    page,
                    limit,
                    total: 0,
                    total_pages: 1,
                    stats,
                    summary,
                },
            });
        }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let listQuery = admin
        .from("orders")
        .select(ORDER_LIST_SELECT, { count: "exact" })
        .eq("company_id", companyId)
        .neq("confirmation_status", "pending_confirmation");

    if (statusFilter !== "all") {
        listQuery = listQuery.eq("status", statusFilter);
    }
    if (customerIds) {
        listQuery = listQuery.in("customer_id", customerIds);
    }

    // Prioridade operacional: novos primeiro, depois por data.
    const { data: pageRows, error: listErr, count } = await listQuery
        .order("created_at", { ascending: false })
        .range(from, to);

    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

    const orders = (pageRows ?? []) as Array<
        Record<string, unknown> & { id: string; status?: string | null; created_at?: string | null }
    >;
    const ids = orders.map((o) => o.id);

    let itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
    if (ids.length > 0) {
        const { data: items, error: itemsErr } = await admin
            .from("order_items")
            .select(ORDER_ITEM_PREVIEW_SELECT)
            .in("order_id", ids);
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
        itemsByOrder = new Map();
        for (const it of items ?? []) {
            const oid = String((it as { order_id: string }).order_id);
            const arr = itemsByOrder.get(oid) ?? [];
            arr.push(it as Record<string, unknown>);
            itemsByOrder.set(oid, arr);
        }
    }

    const enriched = orders.map((o) => ({
        ...o,
        order_items: itemsByOrder.get(o.id) ?? [],
    }));

    // Ordenação por prioridade de status na página atual (UI legada).
    const priority: Record<string, number> = {
        new: 0,
        preparing: 1,
        delivered: 2,
        finalized: 3,
        canceled: 4,
    };
    enriched.sort((a, b) => {
        const pa = priority[String(a.status ?? "")] ?? 99;
        const pb = priority[String(b.status ?? "")] ?? 99;
        if (pa !== pb) return pa - pb;
        return (
            new Date(String(b.created_at ?? 0)).getTime() -
            new Date(String(a.created_at ?? 0)).getTime()
        );
    });

    const total = count ?? enriched.length;
    return NextResponse.json({
        orders: enriched,
        meta: {
            page,
            limit,
            total,
            total_pages: Math.max(1, Math.ceil(total / limit)),
            stats,
            summary,
        },
    });
}

export async function PATCH(req: Request) {
    const ctx = await requireCapability("orders.status");
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
        settle?: boolean;
        due_date?: string | null;
        idempotency_key?: string | null;
    };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    let statusChangedTo: string | null = null;

    if (body.status != null) {
        const nextStatus = String(body.status).trim().toLowerCase();

        if (nextStatus === "canceled") {
            const note = body.details != null ? String(body.details).trim() : "";
            if (!note) {
                return NextResponse.json({ error: "reason_required" }, { status: 400 });
            }
            try {
                await reverseOrderSale(admin, {
                    companyId,
                    orderId: id,
                    reason: note,
                    rejectConfirmation: false,
                    idempotencyKey: body.idempotency_key?.trim() || `order:${id}:reverse:cancel`,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : "cancel_failed";
                return financeRpcFailure(msg);
            }
            statusChangedTo = "canceled";
        } else {
            const { data: rpcData, error: sErr } = await admin.rpc("rpc_set_order_status", {
                p_company_id: companyId,
                p_order_id: id,
                p_status: nextStatus,
                p_details: body.details !== undefined ? body.details : null,
                p_payment_method:
                    body.payment_method !== undefined ? body.payment_method : null,
            });
            if (sErr) {
                const msg = sErr.message ?? "status_update_failed";
                const conflict =
                    /não permitida|não pode|inválido|pedido não encontrado/i.test(msg);
                return NextResponse.json(
                    { error: msg },
                    { status: conflict ? 409 : 500 }
                );
            }

            const result = (rpcData ?? {}) as SetStatusRpcResult;
            statusChangedTo = String(result.status ?? nextStatus);

            if (body.settle === true && statusChangedTo === "finalized") {
                try {
                    await recognizeOrderSale(admin, {
                        companyId,
                        orderId: id,
                        idempotencyKey:
                            body.idempotency_key?.trim() || `order:${id}:recognize`,
                        dueDate: body.due_date ? String(body.due_date).slice(0, 10) : null,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : "recognize_failed";
                    return financeRpcFailure(msg);
                }
            }

            // Notify best-effort: nunca desfaz o status.
            // Outbound via SQS + Lambda (ADR-0003); detect-abandoned-carts cron enfileira
            // só sai rápido se o wake rodar (igual cart_recovery). Cron Vercel é diário.
            if (result.changed && statusChangedTo === "preparing") {
                try {
                    const notify = await enqueuePreparingNotify({
                        admin,
                        companyId,
                        orderId: id,
                        orderCode: String(result.order_code ?? `#${id.slice(-6).toUpperCase()}`),
                        customerId: result.customer_id ?? null,
                        fulfillmentType: result.fulfillment_type ?? null,
                    });
                    if (notify.enqueued) {
                        if (notify.job) {
                            scheduleOutboundAfterEnqueue(
                                admin,
                                [notify.job],
                                "order_preparing"
                            );
                        } else {
                            scheduleOutboundAfterEnqueueLookup(admin, {
                                companyId,
                                dedupKeys: [`order_preparing:${id}`],
                                reason: "order_preparing",
                                limit: 5,
                            });
                        }
                    }
                } catch (err) {
                    console.warn(
                        "[admin/orders] preparing notify:",
                        err instanceof Error ? err.message : err
                    );
                }
            }
        }

        try {
            const { pushMarketplaceOrderStatus } = await import(
                "@/src/marketplaces/services/pushMarketplaceOrderStatus"
            );
            await pushMarketplaceOrderStatus(admin, companyId, id, statusChangedTo);
        } catch (err) {
            console.warn(
                "[admin/orders] marketplace status push:",
                err instanceof Error ? err.message : err
            );
        }
    }

    const patch: Record<string, unknown> = {};
    // details/payment_method já aplicados na RPC de status quando status veio no body
    if (body.status == null) {
        if (body.details !== undefined) patch.details = body.details;
        if (body.payment_method !== undefined) patch.payment_method = body.payment_method;
    }
    if (body.paid !== undefined) patch.paid = !!body.paid;
    if (body.change_for !== undefined) patch.change_for = body.change_for;
    if (body.customer_id !== undefined) patch.customer_id = String(body.customer_id);
    if (body.delivery_fee !== undefined) patch.delivery_fee = Number(body.delivery_fee ?? 0);
    if (body.total_amount !== undefined) patch.total_amount = Number(body.total_amount ?? 0);

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
        return NextResponse.json({ ok: true, order: data, status: statusChangedTo });
    }

    const { data: row } = await admin
        .from("orders")
        .select("id, status")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
    if (!row) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, order: row, status: statusChangedTo ?? row.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("orders.write");
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
        delivery_address?: string | null;
        fulfillment_type?: string | null;
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

    const fulfillmentType: FulfillmentType =
        parseFulfillmentType(body.fulfillment_type) ?? "delivery";
    const policy = await loadFulfillmentPolicy(admin, companyId);
    const allowed = assertFulfillmentAllowed(policy, fulfillmentType);
    if (!allowed.ok) {
        return NextResponse.json({ error: allowed.error }, { status: 409 });
    }

    const isPickup = fulfillmentType === "pickup";
    const fee = isPickup ? 0 : Number(body.delivery_fee ?? 0);
    const deliveryAddress = isPickup
        ? PICKUP_ADDRESS_LABEL
        : body.delivery_address != null
          ? String(body.delivery_address).trim() || null
          : null;
    const rpcItems = orderItemsForAdminRpc(items);
    const driverId = isPickup ? null : String(body.driver_id ?? "").trim() || null;

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
        p_delivery_fee: fee,
        p_details: body.details != null ? String(body.details) : null,
        p_driver_id: driverId,
        p_source: body.source != null && String(body.source).trim() !== "" ? String(body.source).trim() : null,
        p_items: rpcItems,
        p_fulfillment_type: fulfillmentType,
        p_delivery_address: deliveryAddress,
    });

    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    if (!orderId) return NextResponse.json({ error: "order_create_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, order_id: orderId as string });
}
