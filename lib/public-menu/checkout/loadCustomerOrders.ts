import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    PublicMenuOrderDetail,
    PublicMenuOrderSummary,
} from "@/src/types/contracts.public-menu";
import {
    publicMenuOrderCode,
    publicMenuOrderStatusLabel,
    publicMenuPaymentLabel,
} from "./orderStatusLabel";

type OrderRow = {
    id: string;
    created_at: string;
    status: string;
    confirmation_status: string | null;
    total_amount: number | string | null;
    total: number | string | null;
    delivery_fee: number | string | null;
    delivery_address: string | null;
    payment_method: string | null;
    change_for: number | string | null;
    source: string | null;
    channel: string | null;
    order_items:
        | Array<{
              product_name: string | null;
              quantity: number | string | null;
              unit_price: number | string | null;
              line_total?: number | string | null;
          }>
        | null;
};

function money(n: unknown): number {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
}

function toSummary(row: OrderRow): PublicMenuOrderSummary {
    const items = row.order_items ?? [];
    const itemCount = items.reduce((s, i) => s + Math.max(0, Math.floor(Number(i.quantity) || 0)), 0);
    return {
        id: String(row.id),
        orderCode: publicMenuOrderCode(row.id),
        createdAt: String(row.created_at),
        status: String(row.status ?? ""),
        confirmationStatus: row.confirmation_status,
        statusLabel: publicMenuOrderStatusLabel(row.status, row.confirmation_status),
        grandTotal: money(row.total_amount),
        itemCount,
        paymentMethod: row.payment_method,
    };
}

function toDetail(row: OrderRow): PublicMenuOrderDetail {
    const summary = toSummary(row);
    const items = (row.order_items ?? []).map((i) => {
        const quantity = Math.max(0, Math.floor(Number(i.quantity) || 0));
        const unitPrice = money(i.unit_price);
        const lineTotal =
            i.line_total != null && i.line_total !== ""
                ? money(i.line_total)
                : unitPrice * quantity;
        return {
            productName: String(i.product_name ?? "Item"),
            quantity,
            unitPrice,
            lineTotal,
        };
    });
    const deliveryFee = money(row.delivery_fee);
    const subtotal = row.total != null ? money(row.total) : Math.max(0, summary.grandTotal - deliveryFee);
    return {
        ...summary,
        subtotal,
        deliveryFee,
        deliveryAddress: row.delivery_address,
        changeFor: row.change_for == null ? null : money(row.change_for),
        paymentLabel: publicMenuPaymentLabel(row.payment_method),
        items,
        source: row.source,
        channel: row.channel,
    };
}

const SELECT_LIST = `
    id, created_at, status, confirmation_status,
    total_amount, total, delivery_fee, delivery_address,
    payment_method, change_for, source, channel,
    order_items ( product_name, quantity, unit_price, line_total )
`;

export async function listCustomerOrdersForMenu(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    limit = 15
): Promise<PublicMenuOrderSummary[]> {
    const { data, error } = await admin
        .from("orders")
        .select(SELECT_LIST)
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        console.error("[public-menu] list orders:", error.message);
        return [];
    }
    return ((data ?? []) as unknown as OrderRow[]).map(toSummary);
}

export async function getCustomerOrderDetailForMenu(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    orderId: string
): Promise<PublicMenuOrderDetail | null> {
    const { data, error } = await admin
        .from("orders")
        .select(SELECT_LIST)
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("id", orderId)
        .maybeSingle();

    if (error) {
        console.error("[public-menu] order detail:", error.message);
        return null;
    }
    if (!data) return null;
    return toDetail(data as unknown as OrderRow);
}
