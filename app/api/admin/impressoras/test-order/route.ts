import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { enqueuePrintJob } from "@/lib/server/print/enqueuePrintJob";

export const runtime = "nodejs";

export async function POST() {
    const ctx = await requireCapability("print.operate");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const { data: order, error: orderErr } = await admin
        .from("orders")
        .insert({
            company_id: companyId,
            channel: "admin",
            source: "ui",
            status: "new",
            confirmation_status: "confirmed",
            total: 0,
            delivery_fee: 0,
            payment_method: "pix",
            paid: false,
        })
        .select("id")
        .single();
    if (orderErr || !order?.id) {
        return NextResponse.json({ error: orderErr?.message ?? "Erro ao criar pedido de teste" }, { status: 500 });
    }

    const { error: itemErr } = await admin.from("order_items").insert({
        order_id: order.id,
        company_id: companyId,
        product_name: "Teste Cupom",
        quantity: 1,
        qty: 1,
        unit_price: 0,
        unit_type: "unit",
    });
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });

    const queued = await enqueuePrintJob({
        admin,
        companyId,
        orderId: String(order.id),
        source: "reprint",
        priority: 5,
    });
    if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: 500 });

    return NextResponse.json({ ok: true, order_id: order.id, job_id: queued.jobId });
}
