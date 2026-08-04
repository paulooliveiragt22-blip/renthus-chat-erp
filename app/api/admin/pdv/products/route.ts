import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("view_pdv_produtos")
        .select(
            "id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, product_unit_type, product_details, category_name"
        )
        .eq("company_id", companyId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
}
