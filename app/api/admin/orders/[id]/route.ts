import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const id = String(params.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data: ord, error: ordErr } = await admin
        .from("orders")
        .select(`id, status, confirmation_status, channel, source, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address ), drivers ( id, name, vehicle, plate )`)
        .eq("id", id)
        .eq("company_id", companyId)
        .single();
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });

    const { data: items, error: itemsErr } = await admin
        .from("order_items")
        .select(`id, order_id, produto_embalagem_id, product_name, quantity, unit_type, unit_price, line_total, created_at, qty`)
        .eq("order_id", id)
        .order("created_at", { ascending: true });
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

    const rows = Array.isArray(items) ? items : [];
    const embIds = [...new Set(rows.filter((i: any) => i.produto_embalagem_id).map((i: any) => i.produto_embalagem_id))];
    let embMap = new Map<string, Record<string, unknown>>();
    if (embIds.length > 0) {
        const { data: embs } = await admin
            .from("view_pdv_produtos")
            .select("id, product_name, descricao, sigla_comercial, volume_formatado, fator_conversao")
            .in("id", embIds);
        if (embs) embMap = new Map((embs as Record<string, unknown>[]).map((e) => [String(e.id), e]));
    }

    const enrichedItems = rows.map((it: any) => ({
        ...it,
        qty: it?.qty ?? it?.quantity ?? 0,
        quantity: it?.quantity ?? it?.qty ?? 0,
        _emb: it?.produto_embalagem_id ? embMap.get(String(it.produto_embalagem_id)) ?? null : null,
    }));

    return NextResponse.json({ order: { ...(ord as Record<string, unknown>), items: enrichedItems } });
}
