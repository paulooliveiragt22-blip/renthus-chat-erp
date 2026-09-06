// app/api/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey } from "@/lib/print/agents";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { maskPhoneForImpersonation } from "@/lib/platform/impersonation";

export const runtime = "nodejs";

/** Campos explícitos (sem orders.*) — colunas reais do schema. */
const ORDER_SELECT =
    "id, company_id, customer_id, customer_name, customer_phone, delivery_address, payment_method, change_for, notes, total, total_amount, status, confirmation_status, channel, source, created_at, printed_at, paid, delivery_fee, details, driver_id, fulfillment_type, service_fees_total, customers ( name, phone, address ), drivers ( id, name, vehicle, plate )";

/** Agent de impressão: PII mínima para cupom. */
const ORDER_SELECT_AGENT =
    "id, company_id, customer_id, customer_name, customer_phone, delivery_address, payment_method, change_for, notes, total, total_amount, status, created_at, delivery_fee, details, driver_id, customers ( name, phone, address ), drivers ( id, name, vehicle, plate )";

const ITEMS_SELECT =
    "id, order_id, product_name, unit_type, quantity, unit_price, line_total, created_at, produto_embalagem_id, produto_embalagens ( descricao, fator_conversao, siglas_comerciais ( sigla, descricao ), product_volumes ( volume_quantidade, unit_types ( sigla ) ), products ( name ) )";

function redactOrderForImpersonation(
    order: Record<string, unknown>,
    impersonating: boolean
): Record<string, unknown> {
    if (!impersonating) return order;
    const customers = order.customers as Record<string, unknown> | null | undefined;
    return {
        ...order,
        customer_phone: maskPhoneForImpersonation(
            typeof order.customer_phone === "string" ? order.customer_phone : null
        ),
        delivery_address: order.delivery_address ? "[redacted]" : null,
        customers: customers
            ? {
                  ...customers,
                  phone: maskPhoneForImpersonation(
                      typeof customers.phone === "string" ? customers.phone : null
                  ),
                  address: customers.address ? "[redacted]" : null,
              }
            : customers,
    };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: rawOrderId } = await params;
        const orderId = String(rawOrderId || "").trim();
        if (!orderId) return NextResponse.json({ error: "order_id required" }, { status: 400 });

        const authHeader = (req.headers.get("authorization") || "").replaceAll(/^Bearer\s+/gi, "").trim();
        if (authHeader) {
            const agent = await verifyAgentByApiKey(authHeader);
            if (agent) {
                const admin = createAdminClient();

                const { data: order, error: orderErr } = await admin
                    .from("orders")
                    .select(ORDER_SELECT_AGENT)
                    .eq("id", orderId)
                    .maybeSingle();

                if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
                if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

                if (String(order.company_id) !== String(agent.company_id)) {
                    return NextResponse.json({ error: "forbidden" }, { status: 403 });
                }

                const { data: items, error: itemsErr } = await admin
                    .from("order_items")
                    .select(ITEMS_SELECT)
                    .eq("order_id", orderId)
                    .order("created_at", { ascending: true });

                return NextResponse.json({ order, items: itemsErr ? [] : items });
            }
        }

        // Cookie/session: exige orders.read (não só membership)
        const access = await requireCapability("orders.read");
        if (!access.ok) {
            return NextResponse.json(
                { error: access.error },
                { status: access.status }
            );
        }
        const { admin, companyId } = access;

        const { data: order, error: orderErr } = await admin
            .from("orders")
            .select(ORDER_SELECT)
            .eq("id", orderId)
            .eq("company_id", companyId)
            .maybeSingle();

        if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
        if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

        const { data: items, error: itemsErr } = await admin
            .from("order_items")
            .select(ITEMS_SELECT)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        return NextResponse.json({
            order: redactOrderForImpersonation(
                order as Record<string, unknown>,
                access.impersonating
            ),
            items: itemsErr ? [] : items,
            pii_redacted: access.impersonating,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
