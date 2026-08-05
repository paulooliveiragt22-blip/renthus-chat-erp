/**
 * GET   /api/admin/products/[id] — produto completo (rpc_get_product_full) + acompanhamentos
 * PATCH /api/admin/products/[id] — update completo ou toggle is_active
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type VolumeItemBody = {
    id_sigla_comercial?: string;
    descricao?: string | null;
    fator_conversao?: number;
    preco_venda?: number;
    preco_custo?: number | null;
    codigo_interno?: string | null;
    codigo_barras_ean?: string | null;
    tags?: string | null;
    is_acompanhamento?: boolean;
    estoque?: string | null;
    estoque_minimo?: string | null;
};

type VolumeBody = {
    volume_quantidade?: number | null;
    id_unit_type?: string | null;
    estoque_atual?: number;
    estoque_minimo?: number;
    items?: VolumeItemBody[];
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_get_product_full", {
        p_product_id: productId,
        p_company_id: companyId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

    // Preferência: embalagem da linha da lista (mesmo comportamento do client antigo).
    const embFromQuery = String(req.nextUrl.searchParams.get("embalagem_id") ?? "").trim();
    const prod = data as { volumes?: Array<{ items?: Array<{ id?: string }> }> };
    const embIdsFromProduct = (prod.volumes ?? [])
        .flatMap((v) => v.items ?? [])
        .map((it) => String(it.id ?? ""))
        .filter(Boolean);
    const embId =
        embFromQuery && embIdsFromProduct.includes(embFromQuery)
            ? embFromQuery
            : embIdsFromProduct[0] ?? "";

    let acompanhamentoIds: string[] = [];
    if (embId) {
        const { data: ac } = await admin
            .from("view_produto_embalagem_acompanhamentos")
            .select("acompanhamento_produto_embalagem_id")
            .eq("produto_embalagem_id", embId)
            .order("ordem");
        acompanhamentoIds = ((ac ?? []) as Array<{ acompanhamento_produto_embalagem_id?: string }>).map((x) =>
            String(x.acompanhamento_produto_embalagem_id ?? "")
        ).filter(Boolean);
    }

    return NextResponse.json({ product: data, acompanhamento_ids: acompanhamentoIds });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as {
        is_active?: boolean;
        vender_com_estoque_zero?: boolean;
        category_id?: string;
        volumes?: VolumeBody[];
        acompanhamento_ids?: string[];
        toggle_only?: boolean;
        toggle_vender_estoque_zero?: boolean;
    };

    // Toggle rápido: vender com estoque zero
    if (body.toggle_vender_estoque_zero === true && typeof body.vender_com_estoque_zero === "boolean") {
        const { error } = await admin.rpc("rpc_set_product_vender_com_estoque_zero", {
            p_product_id: productId,
            p_company_id: companyId,
            p_value: body.vender_com_estoque_zero,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({
            ok: true,
            vender_com_estoque_zero: body.vender_com_estoque_zero,
        });
    }

    // Toggle rápido (lista)
    if (body.toggle_only === true || (body.volumes === undefined && typeof body.is_active === "boolean" && body.vender_com_estoque_zero === undefined)) {
        const { error } = await admin.rpc("rpc_toggle_product_active", {
            p_product_id: productId,
            p_company_id: companyId,
            p_is_active: Boolean(body.is_active),
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, is_active: Boolean(body.is_active) });
    }

    const categoryId = String(body.category_id ?? "").trim();
    const volumes = Array.isArray(body.volumes) ? body.volumes : [];
    if (!categoryId) return NextResponse.json({ error: "category_required" }, { status: 400 });
    if (volumes.length === 0) {
        return NextResponse.json({ error: "volumes_required" }, { status: 400 });
    }

    const { error } = await admin.rpc("rpc_update_product_with_items", {
        p_company_id: companyId,
        p_product_id: productId,
        p_category_id: categoryId,
        p_is_active: body.is_active !== false,
        p_volumes: volumes,
        p_acompanhamento_ids: Array.isArray(body.acompanhamento_ids) ? body.acompanhamento_ids : [],
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (typeof body.vender_com_estoque_zero === "boolean") {
        const { error: flagErr } = await admin.rpc("rpc_set_product_vender_com_estoque_zero", {
            p_product_id: productId,
            p_company_id: companyId,
            p_value: body.vender_com_estoque_zero,
        });
        if (flagErr) return NextResponse.json({ error: flagErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}
