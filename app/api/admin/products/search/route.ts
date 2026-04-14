import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type SearchVariant = {
    id: string;
    unit_price: number;
    has_case: boolean;
    case_qty: number | null;
    case_price: number | null;
    unit: string | null;
    volume_value: null;
    details: string | null;
    tags: string;
    is_active: boolean;
    codigo_interno: string | null;
    unit_embalagem_id: string | null;
    case_embalagem_id: string | null;
    products: { name?: string | null; categories?: { name?: string | null } | null } | null;
};

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return NextResponse.json({ variants: [] });

    const { data, error } = await admin
        .from("view_pdv_produtos")
        .select("id, produto_id, product_volume_id, descricao, fator_conversao, preco_venda, tags, codigo_interno, sigla_comercial, volume_formatado, product_name, product_unit_type, product_details, category_name")
        .eq("company_id", companyId)
        .limit(400);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const byGroup = new Map<string, Record<string, unknown>>();
    for (const r of (data ?? []) as Record<string, unknown>[]) {
        const pid = String(r.produto_id ?? "");
        const volKey = r.product_volume_id ? String(r.product_volume_id) : "novol";
        const groupKey = `${pid}__${volKey}`;
        const entry = byGroup.get(groupKey) ?? {
            id: groupKey,
            products: { name: r.product_name ?? "", categories: { name: r.category_name ?? "" } },
            tags: [] as string[],
            unitPack: null as Record<string, unknown> | null,
            casePack: null as Record<string, unknown> | null,
            unit: r.product_unit_type ?? null,
            is_active: true,
            codigo_interno: null as string | null,
        };

        if (r.tags) (entry.tags as string[]).push(String(r.tags));
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN") {
            entry.unitPack = r;
            entry.codigo_interno = String(r.codigo_interno ?? "") || null;
        }
        if (sig === "CX") entry.casePack = r;
        byGroup.set(groupKey, entry);
    }

    const variants: SearchVariant[] = Array.from(byGroup.values()).map((e) => {
        const unitPack = (e.unitPack as Record<string, unknown> | null) ?? (e.casePack as Record<string, unknown> | null);
        const casePack = e.casePack as Record<string, unknown> | null;
        return {
            id: String(e.id),
            unit_price: Number(unitPack?.preco_venda ?? 0),
            has_case: Boolean(casePack),
            case_qty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
            case_price: casePack ? Number(casePack.preco_venda ?? 0) : null,
            unit: e.unit != null ? String(e.unit) : null,
            volume_value: null,
            details: [unitPack?.descricao, unitPack?.volume_formatado].filter(Boolean).join(" ") || (e.products && (e.products as { name?: string }).name ? String((e.products as { name?: string }).name) : null),
            tags: (e.tags as string[]).filter(Boolean).join(","),
            is_active: true,
            codigo_interno: e.codigo_interno != null ? String(e.codigo_interno) : null,
            unit_embalagem_id: unitPack?.id ? String(unitPack.id) : null,
            case_embalagem_id: casePack?.id ? String(casePack.id) : null,
            products: (e.products as SearchVariant["products"]) ?? null,
        };
    });

    const filtered = variants.filter((v) => {
        const name = String(v.products?.name ?? "").toLowerCase();
        const cat = String(v.products?.categories?.name ?? "").toLowerCase();
        const det = String(v.details ?? "").toLowerCase();
        const unit = String(v.unit ?? "").toLowerCase();
        const internal = String(v.codigo_interno ?? "").toLowerCase();
        const tags = String(v.tags ?? "").toLowerCase();
        return [name, cat, det, unit, internal, tags].some((x) => x.includes(q));
    });

    return NextResponse.json({ variants: filtered.slice(0, 40) });
}
