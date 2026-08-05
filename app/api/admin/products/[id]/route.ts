/**
 * GET    /api/admin/products/[id] — produto completo (rpc_get_product_full) + acompanhamentos
 * PATCH  /api/admin/products/[id] — update completo, toggle produto/item, vender_estoque_zero
 * DELETE /api/admin/products/[id] — exclui se nunca vendido; senão desativa
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type VolumeItemBody = {
    id?: string | null;
    id_sigla_comercial?: string;
    descricao?: string | null;
    detalhes?: string | null;
    fator_conversao?: number;
    preco_venda?: number;
    preco_custo?: number | null;
    codigo_interno?: string | null;
    codigo_barras_ean?: string | null;
    tags?: string | null;
    is_acompanhamento?: boolean;
    is_active?: boolean;
    estoque?: string | null;
    estoque_minimo?: string | null;
};

type VolumeBody = {
    id?: string | null;
    volume_id?: string | null;
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
        name?: string;
        is_active?: boolean;
        vender_com_estoque_zero?: boolean;
        category_id?: string;
        volumes?: VolumeBody[];
        acompanhamento_ids?: string[];
        toggle_only?: boolean;
        toggle_vender_estoque_zero?: boolean;
        toggle_item?: { embalagem_id?: string; is_active?: boolean };
    };

    // Toggle item (embalagem)
    if (body.toggle_item?.embalagem_id && typeof body.toggle_item.is_active === "boolean") {
        const { error } = await admin.rpc("rpc_toggle_produto_embalagem_active", {
            p_embalagem_id: String(body.toggle_item.embalagem_id),
            p_company_id: companyId,
            p_is_active: body.toggle_item.is_active,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({
            ok: true,
            embalagem_id: String(body.toggle_item.embalagem_id),
            is_active: body.toggle_item.is_active,
        });
    }

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

    if (
        body.toggle_only === true ||
        (body.volumes === undefined &&
            typeof body.is_active === "boolean" &&
            body.vender_com_estoque_zero === undefined &&
            body.name === undefined)
    ) {
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

    const nameTrim = body.name != null ? String(body.name).trim() : "";

    const { error } = await admin.rpc("rpc_update_product_with_items", {
        p_company_id: companyId,
        p_product_id: productId,
        p_category_id: categoryId,
        p_is_active: body.is_active !== false,
        p_volumes: volumes,
        p_acompanhamento_ids: Array.isArray(body.acompanhamento_ids) ? body.acompanhamento_ids : [],
        p_name: nameTrim || null,
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

    const detalheItems = volumes.flatMap((vol) =>
        (vol.items ?? []).map((it) => ({
            id_sigla_comercial: it.id_sigla_comercial,
            fator_conversao: it.fator_conversao ?? 1,
            detalhes: it.detalhes ?? null,
        }))
    );
    if (detalheItems.length) {
        const { error: detErr } = await admin.rpc("rpc_apply_produto_embalagens_detalhes", {
            p_company_id: companyId,
            p_product_id: productId,
            p_items: detalheItems,
        });
        if (detErr) return NextResponse.json({ error: detErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_delete_or_deactivate_product", {
        p_product_id: productId,
        p_company_id: companyId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const result = (data ?? {}) as { action?: string; message?: string };
    return NextResponse.json({
        ok: true,
        action: result.action ?? "unknown",
        message: result.message ?? null,
    });
}
