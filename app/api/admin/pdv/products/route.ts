/**
 * GET /api/admin/pdv/products
 * - sem query: top embalagens por sales_count (limit)
 * - ?q=: busca textual (nome/código/tags) com limit
 * - ?code=: match exato por codigo_interno ou EAN (bipagem)
 * - ?facets=categories: lista de categorias distintas (leve)
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { looksLikeScanCode, normalizeScanDigits } from "@/lib/pdv/scanCode";

export const runtime = "nodejs";

const PDV_SELECT =
    "id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, product_unit_type, product_details, category_name";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

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

    return null;
}

function parseLimit(raw: string | null): number {
    const n = Number.parseInt(raw ?? String(DEFAULT_LIMIT), 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, n);
}

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const facets = String(req.nextUrl.searchParams.get("facets") ?? "").trim();
    if (facets === "categories") {
        const { data, error } = await admin
            .from("view_pdv_produtos")
            .select("category_name")
            .eq("company_id", companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const categories = [
            ...new Set(
                (data ?? [])
                    .map((r) => String((r as { category_name?: string | null }).category_name ?? "").trim())
                    .filter(Boolean)
            ),
        ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        return NextResponse.json({ categories });
    }

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

    const qRaw = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    const category = String(req.nextUrl.searchParams.get("category") ?? "").trim();
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

    // Bipagem via ?q= com padrão de scan → trata como code
    if (qRaw && looksLikeScanCode(qRaw)) {
        try {
            const match = await findExactPackByCode(admin, companyId, qRaw);
            return NextResponse.json({
                rows: match ? [match] : [],
                match: match ?? null,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : "lookup_failed";
            return NextResponse.json({ error: msg }, { status: 500 });
        }
    }

    let query = admin
        .from("view_pdv_produtos")
        .select(PDV_SELECT)
        .eq("company_id", companyId);

    if (category && category !== "Todos") {
        query = query.eq("category_name", category);
    }

    if (qRaw.length >= 2) {
        const safe = qRaw.replaceAll(/[%_,]/g, " ").trim();
        if (safe.length >= 2) {
            query = query.or(
                `product_name.ilike.%${safe}%,codigo_interno.ilike.%${safe}%,tags.ilike.%${safe}%,descricao.ilike.%${safe}%`
            );
        }
    }

    const { data, error } = await query
        .order("sales_count", { ascending: false })
        .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
}
