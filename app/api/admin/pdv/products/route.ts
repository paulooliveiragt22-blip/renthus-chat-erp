/**
 * GET /api/admin/pdv/products
 * - sem query: lista embalagens (view_pdv_produtos)
 * - ?code=: match exato por codigo_interno ou EAN (bipagem)
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { normalizeScanDigits } from "@/lib/pdv/scanCode";

export const runtime = "nodejs";

const PDV_SELECT =
    "id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, product_unit_type, product_details, category_name";

async function findExactPackByCode(
    admin: SupabaseClient,
    companyId: string,
    code: string
): Promise<Record<string, unknown> | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;

    const { data: byInternal, error: errInternal } = await admin
        .from("view_pdv_produtos")
        .select(PDV_SELECT)
        .eq("company_id", companyId)
        .eq("codigo_interno", trimmed)
        .limit(2);
    if (errInternal) throw new Error(errInternal.message);
    if (byInternal?.length) return byInternal[0] as Record<string, unknown>;

    // Case-insensitive (ilike sem % = igualdade CI)
    const safeIlike = trimmed.replaceAll(/[%_]/g, "");
    if (safeIlike) {
        const { data: byInternalCi, error: errCi } = await admin
            .from("view_pdv_produtos")
            .select(PDV_SELECT)
            .eq("company_id", companyId)
            .ilike("codigo_interno", safeIlike)
            .limit(2);
        if (errCi) throw new Error(errCi.message);
        if (byInternalCi?.length) return byInternalCi[0] as Record<string, unknown>;
    }

    const { data: byEan, error: errEan } = await admin
        .from("view_pdv_produtos")
        .select(PDV_SELECT)
        .eq("company_id", companyId)
        .eq("codigo_barras_ean", trimmed)
        .limit(2);
    if (errEan) throw new Error(errEan.message);
    if (byEan?.length) return byEan[0] as Record<string, unknown>;

    const digits = normalizeScanDigits(trimmed);
    if (digits.length >= 4 && digits !== trimmed) {
        const { data: byEanDigits, error: errDigits } = await admin
            .from("view_pdv_produtos")
            .select(PDV_SELECT)
            .eq("company_id", companyId)
            .eq("codigo_barras_ean", digits)
            .limit(2);
        if (errDigits) throw new Error(errDigits.message);
        if (byEanDigits?.length) return byEanDigits[0] as Record<string, unknown>;
    }

    // Fallback: EAN pode estar mascarado — varredura curta só com dígitos longos
    if (digits.length >= 8) {
        const { data: candidates, error: errCand } = await admin
            .from("view_pdv_produtos")
            .select(PDV_SELECT)
            .eq("company_id", companyId)
            .not("codigo_barras_ean", "is", null)
            .limit(800);
        if (errCand) throw new Error(errCand.message);
        const hit = (candidates ?? []).find(
            (r) => normalizeScanDigits(String((r as { codigo_barras_ean?: string }).codigo_barras_ean ?? "")) === digits
        );
        if (hit) return hit as Record<string, unknown>;
    }

    return null;
}

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const code = String(req.nextUrl.searchParams.get("code") ?? "").trim();
    if (code) {
        try {
            const match = await findExactPackByCode(admin, companyId, code);
            return NextResponse.json({ match });
        } catch (e) {
            const msg = e instanceof Error ? e.message : "lookup_failed";
            return NextResponse.json({ error: msg }, { status: 500 });
        }
    }

    const { data, error } = await admin
        .from("view_pdv_produtos")
        .select(PDV_SELECT)
        .eq("company_id", companyId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
}
