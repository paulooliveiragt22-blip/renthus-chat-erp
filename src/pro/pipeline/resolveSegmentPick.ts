/**
 * Resolve um segmento de pedido contra hits de busca.
 * Preferência por *sigla comercial* (`siglas_comerciais.sigla`), não só UN/CX.
 */

import type { CompanySigla, CustomerSiglaHabit } from "./customerPackagingHabit";
import { matchExplicitSiglaFromText } from "./siglaMatch";

export type SegmentPickRow = {
    embalagemId: string;
    label: string;
    price?: number | null;
    productName?: string | null;
};

export type ResolveSegmentPickOpts = {
    quantity?: number | null;
    /** Hábito do cliente: sigla dominante neste produto (ex.: "UN", "COMBO"). */
    habitSigla?: CustomerSiglaHabit | null;
    /** Cadastro de siglas da empresa (para match por descrição/sinônimo). */
    companySiglas?: CompanySigla[] | null;
};

function norm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function rowToPick(r: {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    preco_venda?: number | string | null;
}): SegmentPickRow {
    return {
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
        productName: String(r.product_name ?? "").trim() || null,
    };
}

function rowSigla(r: { sigla_comercial?: string | null }): string {
    return String(r.sigla_comercial ?? "").trim().toUpperCase();
}

function fatorOf(r: { fator_conversao?: number | string | null }): number {
    const f = Number(r.fator_conversao ?? 1);
    return Number.isFinite(f) && f > 0 ? f : 1;
}

/** @deprecated Prefer matchExplicitSiglaFromText — mantido p/ testes legados. */
export function prefersCase(segment: string): boolean {
    return /\b(caixa|cx|fardo|pack)\b/u.test(norm(segment));
}

/** @deprecated Prefer matchExplicitSiglaFromText. */
export function prefersUnit(segment: string): boolean {
    const s = norm(segment);
    if (prefersCase(s)) return false;
    if (/\b(unidade|unidades|\bun\b)\b/u.test(s)) return true;
    if (/\blong\s*neck|longneck\b/u.test(s)) return true;
    return false;
}

function brandTokens(segment: string): string[] {
    const stop = new Set([
        "caixa",
        "caixas",
        "cx",
        "fardo",
        "fardos",
        "pack",
        "pacote",
        "pacotes",
        "combo",
        "combos",
        "unidade",
        "unidades",
        "un",
        "lata",
        "long",
        "neck",
        "longneck",
        "garrafa",
        "pet",
        "litros",
        "litro",
        "quero",
        "uma",
        "duas",
        "dois",
        "tres",
        "três",
        "umas",
        "uns",
    ]);
    return norm(segment)
        .split(" ")
        .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d/.test(t));
}

type HitRow = {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    sigla_comercial?: string | null;
    preco_venda?: number | string | null;
    fator_conversao?: number | string | null;
    produto_id?: string | null;
};

function hitSiglaList(items: HitRow[]): string[] {
    return [...new Set(items.map(rowSigla).filter(Boolean))];
}

/**
 * Sigla preferida: texto explícito > hábito > qty vs fator mínimo > long neck→menor fator.
 */
export function resolvePreferredSigla(
    segment: string,
    items: HitRow[],
    opts?: ResolveSegmentPickOpts
): string | null {
    const companySiglas = opts?.companySiglas?.length
        ? opts.companySiglas
        : hitSiglaList(items).map((sigla) => ({ id: sigla, sigla, descricao: null }));

    const explicit = matchExplicitSiglaFromText(segment, companySiglas, hitSiglaList(items));
    if (explicit) return explicit;

    const habit = String(opts?.habitSigla ?? "")
        .trim()
        .toUpperCase();
    if (habit && hitSiglaList(items).includes(habit)) return habit;

    const qty = Number(opts?.quantity);
    const qtyOk = Number.isFinite(qty) && qty > 0 ? qty : null;
    const fatores = items.map(fatorOf);
    const minF = Math.min(...fatores);
    const maxF = Math.max(...fatores);

    const siglaOfMinFator = (): string | null => {
        const candidates = items.filter((r) => fatorOf(r) === minF);
        const un = candidates.find((r) => rowSigla(r) === "UN");
        if (un) return "UN";
        // Empate de fator: evita CX/FARD/PAC pelo nome
        const notCase = candidates.find((r) => {
            const s = rowSigla(r);
            const name = norm(String(r.display_name || r.product_name || ""));
            return !s.includes("CX") && !s.includes("FARD") && !s.includes("PAC") && !/\bcx\b|c\/\d+/u.test(name);
        });
        if (notCase) return rowSigla(notCase) || null;
        return rowSigla(candidates[0]!) || null;
    };

    if (qtyOk != null && maxF > minF && qtyOk < maxF) {
        return siglaOfMinFator();
    }

    // long neck sem sigla → UN se existir; senão menor fator “não caixa”
    if (/\blong\s*neck|longneck\b/u.test(norm(segment))) {
        if (hitSiglaList(items).includes("UN")) return "UN";
        return siglaOfMinFator();
    }

    return null;
}

function scoreItem(segment: string, r: HitRow, preferredSigla: string | null): number {
    const seg = norm(segment);
    const name = norm(String(r.display_name || r.product_name || ""));
    const sigla = rowSigla(r);
    let score = 0;

    if (preferredSigla) {
        if (sigla === preferredSigla) score += 12;
        else score -= 10;
    } else if (fatorOf(r) <= 1) {
        score += 3;
    }

    if (/\blong\s*neck|longneck\b/u.test(seg)) {
        if (/\blong\s*neck|longneck\b/u.test(name)) score += 12;
        if (/\b600\b/u.test(name)) score -= 8;
        if (/\blata\b/u.test(name)) score -= 8;
    }

    const brands = brandTokens(seg);
    if (brands.length) {
        const hit = brands.filter((t) => name.includes(t));
        if (hit.length) score += 14 + hit.length * 4;
        else score -= 16;
    }

    for (const tok of seg.split(" ").filter((t) => t.length >= 4)) {
        if (name.includes(tok)) score += 2;
    }

    if (seg.includes("rosseiro") && name.includes("rosseiro")) score += 14;
    if (seg.includes("salgadinho") && name.includes("salgadinho")) score += 8;

    if (
        preferredSigla === "CX" &&
        /\blong\s*neck|longneck\b/u.test(seg) &&
        /c\/\s*6\b|cx\s*c\/\s*6/u.test(name)
    ) {
        score += 4;
    }

    return score;
}

export function resolveSegmentPick(
    segment: string,
    items: HitRow[],
    opts?: ResolveSegmentPickOpts
):
    | { kind: "unique"; pick: SegmentPickRow }
    | { kind: "ambiguous"; picks: SegmentPickRow[]; habitConflict?: boolean }
    | { kind: "empty" } {
    if (!items.length) return { kind: "empty" };
    if (items.length === 1) return { kind: "unique", pick: rowToPick(items[0]!) };

    const preferredSigla = resolvePreferredSigla(segment, items, opts);

    let ranked = items
        .map((r) => ({ r, score: scoreItem(segment, r, preferredSigla) }))
        .sort((a, b) => b.score - a.score);

    const brands = brandTokens(segment);
    if (brands.length) {
        const withBrand = ranked.filter((x) => {
            const name = norm(String(x.r.display_name || x.r.product_name || ""));
            return brands.some((t) => name.includes(t));
        });
        if (withBrand.length >= 1) ranked = withBrand;
    }

    const best = ranked[0]!;
    const second = ranked[1];
    if (!second || best.score >= second.score + 4) {
        return { kind: "unique", pick: rowToPick(best.r) };
    }

    if (preferredSigla) {
        const only = ranked.filter((x) => rowSigla(x.r) === preferredSigla);
        if (only.length === 1) return { kind: "unique", pick: rowToPick(only[0]!.r) };
        if (only.length >= 2) {
            const a = only[0]!;
            const b = only[1]!;
            if (a.score >= b.score + 3) return { kind: "unique", pick: rowToPick(a.r) };
            return { kind: "ambiguous", picks: only.slice(0, 3).map((x) => rowToPick(x.r)) };
        }
    }

    return {
        kind: "ambiguous",
        picks: ranked.slice(0, 3).map((x) => rowToPick(x.r)),
    };
}
