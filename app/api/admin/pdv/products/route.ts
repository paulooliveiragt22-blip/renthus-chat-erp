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

async function withEffectivePrices(
    admin: SupabaseClient,
    companyId: string,
    rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
    const ids = rows.map((r) => String(r.id ?? "")).filter(Boolean);
    if (ids.length === 0) return rows;
    const { data, error } = await admin
        .from("v_sec_preco_efetivo_embalagem")
        .select("id, preco_efetivo")
        .eq("company_id", companyId)
        .in("id", ids);
    if (error || !data) return rows;
    const byId = new Map(data.map((r) => [String(r.id), Number(r.preco_efetivo)]));
    return rows.map((row) => {
        const next = byId.get(String(row.id ?? ""));
        if (next == null || !Number.isFinite(next) || next <= 0) return row;
        return { ...row, preco_venda: next };
    });
}

async function comboRowsForPdv(
    admin: SupabaseClient,
    companyId: string,
    qRaw: string,
    category: string
): Promise<Record<string, unknown>[]> {
    if (category && category !== "Todos" && category !== "Combos") return [];
    const { data, error } = await admin
        .from("v_sec_combos")
        .select("id, nome, descricao, preco_efetivo, is_active")
        .eq("company_id", companyId)
        .eq("is_active", true);
    if (error || !data) return [];
    const q = qRaw.trim().toLowerCase();
    return data
        .filter((c) => {
            if (q.length < 2) return true;
            return String(c.nome ?? "").toLowerCase().includes(q);
        })
        .map((c) => ({
            id: c.id,
            produto_id: "",
            product_name: c.nome,
            descricao: c.descricao,
            preco_venda: Number(c.preco_efetivo),
            fator_conversao: 1,
            sigla_comercial: "KIT",
            sigla_humanizada: "Combo",
            category_name: "Combos",
            sales_count: 0,
            is_active: true,
        }));
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
        const { count } = await admin
            .from("v_sec_combos")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("is_active", true);
        if ((count ?? 0) > 0) categories.push("Combos");
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
    const rows = await withEffectivePrices(admin, companyId, (data ?? []) as Record<string, unknown>[]);
    const combos = await comboRowsForPdv(admin, companyId, qRaw, category);
    return NextResponse.json({ rows: [...combos, ...rows].slice(0, limit) });
}
