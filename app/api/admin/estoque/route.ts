/**
 * GET  /api/admin/estoque — lista estoque (view_products_estoque)
 * PATCH /api/admin/estoque — ajusta estoque via rpc_update_product_volume_estoque
 * Exige feature estoque_full (Pro/Market).
 */

import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyPlanFeature("estoque_full", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("view_products_estoque")
        .select(
            "id, name, codigo_interno, details, preco_custo_unitario, estoque_atual, estoque_minimo, is_active, category_name, created_at"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = (data ?? []).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? "—"),
        category: String(p.category_name ?? "—"),
        details: p.details == null ? null : String(p.details),
        codigo_interno: p.codigo_interno == null ? null : String(p.codigo_interno),
        preco_custo_unitario: Number(p.preco_custo_unitario ?? 0),
        estoque_atual: Number(p.estoque_atual ?? 0),
        estoque_minimo: Number(p.estoque_minimo ?? 0),
        is_active: Boolean(p.is_active),
    }));

    return NextResponse.json({ items });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyPlanFeature("estoque_full", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        productVolumeId?: string;
        estoqueAtual?: number;
        type?: "entrada" | "saida" | "ajuste";
        qty?: number;
    };

    const productVolumeId = String(body.productVolumeId ?? "").trim();
    if (!productVolumeId) {
        return NextResponse.json({ error: "product_volume_id_required" }, { status: 400 });
    }

    let next: number;
    if (body.estoqueAtual != null && Number.isFinite(Number(body.estoqueAtual))) {
        next = Math.max(0, Number(body.estoqueAtual));
    } else {
        const qty = Number(body.qty);
        const type = body.type;
        if (!qty || qty <= 0 || (type !== "entrada" && type !== "saida" && type !== "ajuste")) {
            return NextResponse.json({ error: "invalid_movement" }, { status: 400 });
        }

        const { data: row, error: readErr } = await admin
            .from("view_products_estoque")
            .select("estoque_atual")
            .eq("company_id", companyId)
            .eq("id", productVolumeId)
            .maybeSingle();
        if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
        if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

        const cur = Number(row.estoque_atual ?? 0);
        if (type === "entrada") next = cur + qty;
        else if (type === "saida") next = Math.max(0, cur - qty);
        else next = qty;
    }

    const { error } = await admin.rpc("rpc_update_product_volume_estoque", {
        p_product_volume_id: productVolumeId,
        p_company_id: companyId,
        p_estoque_atual: next,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, estoque_atual: next, productVolumeId });
}
