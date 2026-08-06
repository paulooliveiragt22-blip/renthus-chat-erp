/**
 * GET  /api/admin/products — lista (view_produtos_lista) + meta (categorias/siglas/unidades)
 * POST /api/admin/products — cria via rpc_create_product_with_items
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const [prodRes, catRes, siglasRes, unitsRes] = await Promise.all([
        admin
            .from("view_produtos_lista")
            .select("*")
            .eq("company_id", companyId)
            .limit(500),
        admin
            .from("view_categories")
            .select("id, name")
            .eq("is_active", true)
            .eq("company_id", companyId)
            .order("name"),
        admin.from("view_siglas_comerciais").select("id, sigla").eq("company_id", companyId),
        admin.from("view_unit_types").select("id, sigla").eq("company_id", companyId),
    ]);

    if (prodRes.error) {
        return NextResponse.json({ error: prodRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
        rows: prodRes.data ?? [],
        categories: (catRes.data ?? []).map((c) => ({
            id: String(c.id),
            name: typeof c.name === "string" ? c.name : "",
        })),
        siglas: (siglasRes.data ?? []).map((s) => ({
            id: String(s.id),
            sigla: String(s.sigla ?? "").toUpperCase(),
        })),
        unitTypes: (unitsRes.data ?? []).map((u) => ({
            id: String(u.id),
            sigla: String(u.sigla ?? ""),
        })),
    });
}

type VolumeItemBody = {
    id_sigla_comercial?: string;
    descricao?: string | null;
    detalhes?: string | null;
    informacoes?: string | null;
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

export async function POST(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        category_id?: string;
        is_active?: boolean;
        vender_com_estoque_zero?: boolean;
        volumes?: VolumeBody[];
        acompanhamento_ids?: string[];
    };

    const name = String(body.name ?? "").trim().toUpperCase();
    const categoryId = String(body.category_id ?? "").trim();
    const volumes = Array.isArray(body.volumes) ? body.volumes : [];

    if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
    if (!categoryId) return NextResponse.json({ error: "category_required" }, { status: 400 });
    if (volumes.length === 0) {
        return NextResponse.json({ error: "volumes_required" }, { status: 400 });
    }

    const { data, error } = await admin.rpc("rpc_create_product_with_items", {
        p_company_id: companyId,
        p_name: name,
        p_category_id: categoryId,
        p_is_active: body.is_active !== false,
        p_volumes: volumes,
        p_acompanhamento_ids: Array.isArray(body.acompanhamento_ids) ? body.acompanhamento_ids : [],
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const productId =
        data && typeof data === "object" && "product_id" in data
            ? String((data as { product_id?: unknown }).product_id ?? "")
            : "";

    if (productId) {
        const { error: flagErr } = await admin.rpc("rpc_set_product_vender_com_estoque_zero", {
            p_product_id: productId,
            p_company_id: companyId,
            p_value: body.vender_com_estoque_zero !== false,
        });
        if (flagErr) {
            return NextResponse.json({ error: flagErr.message }, { status: 500 });
        }

        const detalheItems = volumes.flatMap((vol) =>
            (vol.items ?? []).map((it) => ({
                id_sigla_comercial: it.id_sigla_comercial,
                fator_conversao: it.fator_conversao ?? 1,
                detalhes: it.detalhes ?? null,
                informacoes: it.informacoes ?? null,
            }))
        );
        if (detalheItems.length) {
            const { error: detErr } = await admin.rpc("rpc_apply_produto_embalagens_detalhes", {
                p_company_id: companyId,
                p_product_id: productId,
                p_items: detalheItems,
            });
            if (detErr) {
                return NextResponse.json({ error: detErr.message }, { status: 500 });
            }
        }
    }

    return NextResponse.json({ ok: true, product_id: productId || null, data });
}
