/**
 * Reordenação de resultados de catálogo por dicas do pedido (long neck, CX, volume).
 * Complementa o score fuzzy do RPC — evita oferecer 600ml quando o cliente pediu long neck.
 */

import { normalizeSearchKey } from "./searchNormalize";
import type { ChatProdutoRow } from "./searchProdutos";

export type SearchQueryHints = {
    packaging: "CX" | "UN" | "FARD" | "PAC" | null;
    descriptors: string[];
    volumesMl: number[];
    brandishTokens: string[];
};

const DESCRIPTOR_PHRASES = [
    "long neck",
    "longneck",
    "lata",
    "garrafa",
    "pet",
    "litrao",
    "barril",
] as const;

export function extractSearchQueryHints(query: string): SearchQueryHints {
    const n = normalizeSearchKey(query);
    const descriptors: string[] = [];
    for (const d of DESCRIPTOR_PHRASES) {
        if (n.includes(d)) descriptors.push(d);
    }
    if (n.includes("long") && n.includes("neck") && !descriptors.includes("long neck")) {
        descriptors.push("long neck");
    }

    let packaging: SearchQueryHints["packaging"] = null;
    if (/\b(caixa|caixas|cx|fardo|fardos|pack|packs|pacote|pacotes)\b/u.test(n)) {
        if (/\b(fardo|fardos)\b/u.test(n)) packaging = "FARD";
        else if (/\b(pacote|pacotes|pack|packs)\b/u.test(n)) packaging = "PAC";
        else packaging = "CX";
    } else if (/\b(unidade|unidades|\bun\b)\b/u.test(n)) {
        packaging = "UN";
    }

    const volumesMl: number[] = [];
    for (const m of n.matchAll(/\b(\d{2,4})\s*(?:ml|m)\b/gu)) {
        volumesMl.push(Number(m[1]));
    }
    for (const m of n.matchAll(/\b(\d(?:[.,]\d+)?)\s*l(?:itro)?s?\b/gu)) {
        const lit = Number(String(m[1]).replace(",", "."));
        if (Number.isFinite(lit) && lit > 0 && lit < 20) volumesMl.push(Math.round(lit * 1000));
    }

    const stop = new Set([
        "quero",
        "uma",
        "um",
        "uns",
        "umas",
        "de",
        "da",
        "do",
        "no",
        "na",
        "com",
        "pra",
        "para",
        "me",
        "manda",
        "caixa",
        "caixas",
        "cx",
        "unidade",
        "un",
        "fardo",
        "pagamento",
        "pix",
        "cartao",
        "dinheiro",
        "endereco",
        "mesmo",
        "sempre",
        "long",
        "neck",
        "longneck",
        "lata",
    ]);
    const brandishTokens = n
        .split(" ")
        .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/u.test(t));

    return { packaging, descriptors, volumesMl: [...new Set(volumesMl)], brandishTokens };
}

function rowHaystack(r: ChatProdutoRow): string {
    return normalizeSearchKey(
        [
            r.product_name,
            r.display_name,
            r.descricao,
            r.detalhes,
            r.sigla_comercial,
            r.unit_type_sigla,
            r.volume_quantidade != null ? String(r.volume_quantidade) : "",
        ]
            .filter(Boolean)
            .join(" ")
    );
}

function rowLooksLikeCase(r: ChatProdutoRow): boolean {
    const sigla = String(r.sigla_comercial ?? "").toUpperCase();
    if (sigla === "CX" || sigla === "FARD" || sigla === "PAC") return true;
    const fator = Number(r.fator_conversao ?? 1) || 1;
    if (fator >= 6) return true;
    const h = rowHaystack(r);
    return /\b(cx|caixa|fardo|pack|pacote)\b/u.test(h);
}

function rowVolumeMl(r: ChatProdutoRow): number | null {
    const v = Number(r.volume_quantidade);
    if (!Number.isFinite(v) || v <= 0) return null;
    const unit = String(r.unit_type_sigla ?? "").toLowerCase();
    if (unit === "l" || unit === "lt" || unit === "litro") return Math.round(v * 1000);
    return Math.round(v);
}

function hasDescriptor(hay: string, d: string): boolean {
    if (d === "long neck" || d === "longneck") {
        return hay.includes("long neck") || hay.includes("longneck") || /\blong\s*neck\b/u.test(hay);
    }
    return hay.includes(d);
}

/**
 * Ajusta scores e reordena. Se há descritor (ex. long neck) e algum item casa,
 * penaliza forte itens que contradizem (ex. 600ml sem long neck).
 */
export function applySearchRelevanceRerank(
    query: string,
    rows: ChatProdutoRow[]
): ChatProdutoRow[] {
    if (!rows.length) return rows;
    const hints = extractSearchQueryHints(query);
    const anyDescriptorHit = hints.descriptors.some((d) =>
        rows.some((r) => hasDescriptor(rowHaystack(r), d))
    );

    const scored = rows.map((r) => {
        let score = Number(r.score ?? 0.2);
        const hay = rowHaystack(r);
        const vol = rowVolumeMl(r);

        for (const d of hints.descriptors) {
            if (hasDescriptor(hay, d)) score += 0.28;
            else if (anyDescriptorHit) score -= 0.38;
        }

        if (hints.packaging === "CX" || hints.packaging === "FARD" || hints.packaging === "PAC") {
            if (rowLooksLikeCase(r)) score += 0.18;
            else score -= 0.12;
        } else if (hints.packaging === "UN") {
            if (!rowLooksLikeCase(r)) score += 0.12;
            else score -= 0.08;
        }

        if (hints.volumesMl.length) {
            if (vol != null && hints.volumesMl.some((v) => Math.abs(v - vol) <= 5)) {
                score += 0.22;
            } else if (vol != null) {
                score -= 0.15;
            }
        }

        // long neck tipicamente ≠ 600ml / 1L quando o cliente não pediu esse volume
        if (
            hints.descriptors.some((d) => d.includes("long")) &&
            !hints.volumesMl.length &&
            vol != null &&
            vol >= 500 &&
            !hasDescriptor(hay, "long neck")
        ) {
            score -= 0.45;
        }

        for (const t of hints.brandishTokens) {
            if (hay.includes(t)) score += 0.35;
            else score -= 0.25;
        }

        return { row: { ...r, score }, score };
    });

    scored.sort((a, b) => b.score - a.score || String(a.row.product_name).localeCompare(String(b.row.product_name)));

    // Se há hits de descritor, descarta contraditórios muito fracos
    let out = scored.map((s) => s.row);
    if (hints.brandishTokens.length) {
        const withBrand = out.filter((r) => {
            const hay = rowHaystack(r);
            return hints.brandishTokens.some((t) => hay.includes(t));
        });
        if (withBrand.length >= 1) out = withBrand;
    }
    if (anyDescriptorHit) {
        const strong = out.filter((r) =>
            hints.descriptors.some((d) => hasDescriptor(rowHaystack(r), d))
        );
        if (strong.length >= 1) {
            out = out.filter((r) => {
                const hay = rowHaystack(r);
                const matchesDesc = hints.descriptors.some((d) => hasDescriptor(hay, d));
                if (matchesDesc) return true;
                const vol = rowVolumeMl(r);
                if (
                    hints.descriptors.some((d) => d.includes("long")) &&
                    vol != null &&
                    vol >= 500
                ) {
                    return false;
                }
                return Number(r.score ?? 0) >= 0.55;
            });
        }
    }

    return out;
}
