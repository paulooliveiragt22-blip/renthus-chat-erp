import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

const PDV_SELECT =
    "id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, product_unit_type, product_details, category_name";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const orderId = String(req.nextUrl.searchParams.get("order_id") ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const { data: orderRow, error: ordErr } = await admin
        .from("orders")
        .select("id, source, company_id")
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });
    if (!orderRow) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: items, error: itemsErr } = await admin
        .from("order_items")
        .select("produto_embalagem_id, quantity, qty, product_name, unit_price")
        .eq("order_id", orderId);
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

    const rows = items ?? [];
    const embIds = [
        ...new Set(
            rows
                .map((it) => (it as { produto_embalagem_id?: string | null }).produto_embalagem_id)
                .filter((id): id is string => Boolean(id))
                .map(String)
        ),
    ];

    let packById = new Map<string, Record<string, unknown>>();
    if (embIds.length > 0) {
        const { data: packs, error: packErr } = await admin
            .from("view_pdv_produtos")
            .select(PDV_SELECT)
            .eq("company_id", companyId)
            .in("id", embIds);
        if (packErr) return NextResponse.json({ error: packErr.message }, { status: 500 });
        packById = new Map(
            (packs ?? []).map((p) => [String((p as { id: string }).id), p as Record<string, unknown>])
        );
    }

    const enriched = rows.map((it) => {
        const embId = (it as { produto_embalagem_id?: string | null }).produto_embalagem_id;
        const pack = embId ? packById.get(String(embId)) ?? null : null;
        return { ...it, pack };
    });

    return NextResponse.json({ source: orderRow.source ?? null, items: enriched });
}
