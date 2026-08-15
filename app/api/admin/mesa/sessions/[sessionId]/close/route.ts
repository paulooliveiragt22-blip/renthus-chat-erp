import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

/**
 * Fecha mesa: finaliza via rpc_finalize_pdv_order (caixa) e marca sessão/order como mesa.
 */
export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;

    const body = (await req.json().catch(() => ({}))) as {
        cash_register_id?: string;
        seller_name?: string | null;
        payment_method?: string;
        auto_print?: boolean;
    };

    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    if (!cashRegisterId) {
        return NextResponse.json({ error: "cash_register_required" }, { status: 400 });
    }

    const { data: sessionPayload, error: sessErr } = await admin.rpc("rpc_mesa_get_session", {
        p_company_id: companyId,
        p_session_id: sessionId,
    });
    if (sessErr) {
        return NextResponse.json({ error: sessErr.message }, { status: 500 });
    }
    const session = (sessionPayload as { session?: {
        status?: string;
        total?: number;
        items?: Array<{
            produto_embalagem_id: string;
            product_id?: string | null;
            product_name: string;
            qty: number;
            unit_price: number;
            sigla_comercial?: string | null;
        }>;
        table?: { code?: string };
        customer_id?: string | null;
    } })?.session;

    if (!session || session.status !== "open") {
        return NextResponse.json({ error: "session_not_open" }, { status: 400 });
    }
    const items = Array.isArray(session.items) ? session.items : [];
    if (items.length === 0) {
        return NextResponse.json({ error: "cart_empty" }, { status: 400 });
    }

    const total = Number(session.total ?? 0);
    const { loadAcceptedCustomerPayments } = await import(
        "@/lib/payments/loadAcceptedCustomerPayments"
    );
    const { assertCustomerPaymentAllowed } = await import(
        "@/src/financeiro/domain/acceptedCustomerPayments"
    );
    const accepted = await loadAcceptedCustomerPayments(admin, companyId);
    const pay = assertCustomerPaymentAllowed(
        accepted,
        String(body.payment_method ?? "pix").trim().toLowerCase() || "pix"
    );
    if (!pay.ok) {
        return NextResponse.json({ error: pay.error }, { status: 400 });
    }
    const method = pay.method;
    const tableCode = session.table?.code ?? "";

    const { data: finalized, error: finErr } = await admin.rpc("rpc_finalize_pdv_order", {
        p_company_id: companyId,
        p_payload: {
            cash_register_id: cashRegisterId,
            seller_name: body.seller_name ?? null,
            customer_id: session.customer_id ?? null,
            customer_name: tableCode ? `Mesa ${tableCode}` : "Mesa",
            auto_print: body.auto_print === true,
            cart: items.map((i) => ({
                variant_id: i.produto_embalagem_id,
                produto_id: i.product_id ?? null,
                product_name: i.product_name,
                unit_price: i.unit_price,
                qty: i.qty,
                sigla_comercial: i.sigla_comercial ?? null,
            })),
            payments: [{ method, value: total }],
        },
    });

    if (finErr) {
        return NextResponse.json({ error: finErr.message }, { status: 400 });
    }

    const orderId = (finalized as { order_id?: string } | null)?.order_id;
    if (!orderId) {
        return NextResponse.json({ error: "finalize_missing_order" }, { status: 500 });
    }

    const { data: closed, error: closeErr } = await admin.rpc("rpc_mesa_mark_session_closed", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_order_id: orderId,
    });
    if (closeErr) {
        return NextResponse.json({ error: closeErr.message }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        orderId,
        saleId: (finalized as { sale_id?: string }).sale_id ?? null,
        closed,
    });
}
