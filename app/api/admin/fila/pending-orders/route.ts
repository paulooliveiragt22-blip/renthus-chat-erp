import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select(
            `
        id, customer_id, customer_phone, delivery_address, payment_method,
        total, total_amount, delivery_fee, change_for, created_at,
        customers ( name, phone ),
        order_items ( product_name, quantity, unit_price, line_total, produto_embalagem_id )
      `
        )
        .eq("company_id", companyId)
        .eq("confirmation_status", "pending_confirmation")
        .order("created_at", { ascending: true })
        .limit(50);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rawOrders = (data ?? []) as Record<string, unknown>[];
    const allEmbIds = [
        ...new Set(
            rawOrders.flatMap((o) => {
                const items = (o.order_items as Record<string, unknown>[]) ?? [];
                return items.map((i) => i.produto_embalagem_id).filter(Boolean) as string[];
            })
        ),
    ];

    let embMap = new Map<string, Record<string, unknown>>();
    if (allEmbIds.length > 0) {
        const { data: embs } = await admin
            .from("view_pdv_produtos")
            .select("id, product_name, descricao, sigla_comercial, volume_formatado, fator_conversao")
            .in("id", allEmbIds);
        if (embs) embMap = new Map((embs as Record<string, unknown>[]).map((e) => [String(e.id), e]));
    }

    const orders = rawOrders.map((o) => {
        const items = ((o.order_items as Record<string, unknown>[]) ?? []).map((i) => ({
            ...i,
            _emb: i.produto_embalagem_id ? embMap.get(String(i.produto_embalagem_id)) ?? null : null,
        }));
        return { ...o, order_items: items };
    });

    return NextResponse.json({ orders });
}
