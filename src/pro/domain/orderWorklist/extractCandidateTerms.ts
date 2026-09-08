/**
 * Fallback lexical multi-item (ADR 0011 D4) — NÃO é fonte canônica da worklist.
 * Usado quando extract LLM falha/vazio **ou** devolve menos itens que o lexical
 * (merge no seed — evita selar só o último termo ambíguo).
 */

import { parsePtQuantity } from "@/src/pro/tools/parseQtyPt";
import { MAX_WORKLIST_LINES } from "@/src/pro/domain/orderWorklist/orderWorklist";

const FILLER_TOKENS = new Set([
    "quero",
    "queria",
    "preciso",
    "precisa",
    "tem",
    "pode",
    "me",
    "por",
    "favor",
    "pf",
    "pfv",
    "o",
    "a",
    "os",
    "as",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "mais",
    "tambem",
    "tb",
    "so",
    "apenas",
    "pedido",
    "pedindo",
]);

const PACK_ONLY_RE =
    /^(?:\d+|um|uma|uns|umas|dois|duas|tres|três)?\s*(?:caixa|caixas|unidade|unidades|fardo|fardos|pacote|pacotes|lata|latas|garrafa|garrafas|un|cx|fard|pac)s?$/i;

const FULFILLMENT_OR_PAYMENT_RE =
    /^(entrega|entregar|retirada|retirar|buscar|pix|dinheiro|cartao|cartão|credito|crédito|debito|débito|especie|espécie)$/i;

const QTY_START_RE = /(?:\d+|um|uma|uns|umas|dois|duas|tres|três)/i;

export type LexicalCandidateTerm = {
    rawTerm: string;
    quantity: number | null;
};

export function normalizePendingTerm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

const QTY_LIKE_TOKENS = new Set([
    "um",
    "uma",
    "uns",
    "umas",
    "dois",
    "duas",
    "tres",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
]);

function tokensHaveQtyLike(tokens: readonly string[]): boolean {
    return tokens.some((t) => QTY_LIKE_TOKENS.has(t) || /^\d+$/.test(t));
}

const SIZE_VARIANT_TOKENS = new Set(["p", "m", "g", "gg", "xg", "pp"]);

export function pendingTermsReferToSame(a: string, b: string): boolean {
    const na = normalizePendingTerm(a);
    const nb = normalizePendingTerm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;

    const allA = na.split(" ").filter(Boolean);
    const allB = nb.split(" ").filter(Boolean);
    /** "marmitas m" ≠ "marmitas g" — tamanho curto não pode ser descartado no match. */
    const sizeA = allA.filter((t) => SIZE_VARIANT_TOKENS.has(t));
    const sizeB = allB.filter((t) => SIZE_VARIANT_TOKENS.has(t));
    if (sizeA.length && sizeB.length && sizeA.join("|") !== sizeB.join("|")) {
        return false;
    }

    const ta = allA.filter((t) => t.length >= 3);
    const tb = allB.filter((t) => t.length >= 3);
    if (ta.length === 1 && tb.includes(ta[0]!)) {
        if (tb.length === 1) return true;
        if (tokensHaveQtyLike(allB)) return false;
        return true;
    }
    if (tb.length === 1 && ta.includes(tb[0]!)) {
        if (ta.length === 1) return true;
        if (tokensHaveQtyLike(allA)) return false;
        return true;
    }
    return false;
}

function uniqueLexicalTerms(terms: readonly LexicalCandidateTerm[]): LexicalCandidateTerm[] {
    const out: LexicalCandidateTerm[] = [];
    for (const row of terms) {
        const t = String(row.rawTerm ?? "").trim();
        if (!t) continue;
        if (out.some((x) => pendingTermsReferToSame(x.rawTerm, t))) continue;
        out.push({
            rawTerm: t,
            quantity:
                row.quantity != null && Number.isFinite(row.quantity) && row.quantity >= 1
                    ? Math.floor(row.quantity)
                    : null,
        });
        if (out.length >= MAX_WORKLIST_LINES) break;
    }
    return out;
}

function stripFillerPrefix(segment: string): string {
    const parts = normalizePendingTerm(segment).split(" ").filter(Boolean);
    while (parts.length && FILLER_TOKENS.has(parts[0]!)) parts.shift();
    return parts.join(" ").trim();
}

function isNoiseSegment(normalized: string): boolean {
    if (!normalized || normalized.length < 2) return true;
    if (PACK_ONLY_RE.test(normalized)) return true;
    if (FULFILLMENT_OR_PAYMENT_RE.test(normalized)) return true;
    if (/^\d+$/.test(normalized)) return true;
    return false;
}

export function splitOnJuxtaposedQuantities(segment: string): string[] {
    const raw = String(segment ?? "").trim();
    if (!raw) return [];
    const parts = raw.split(
        new RegExp(`(?<=\\S)\\s+(?=${QTY_START_RE.source}\\s+\\S)`, "i")
    );
    return parts.map((p) => p.trim()).filter(Boolean);
}

const PACK_LEAD_RE =
    /^(caixa|caixas|unidade|unidades|fardo|fardos|pacote|pacotes|lata|latas|garrafa|garrafas|un|cx|fard|pac)s?\s+(?:de\s+)?/i;

function parseProductSegment(segment: string): LexicalCandidateTerm | null {
    const stripped = stripFillerPrefix(segment);
    if (!stripped) return null;
    const m = stripped.match(/^(?:\d+|um|uma|uns|umas|dois|duas|tres|três)\s+/i);
    let quantity: number | null = null;
    let rest = stripped;
    if (m) {
        const qtyTok = m[0]!.trim().split(/\s+/)[0]!;
        quantity = parsePtQuantity(qtyTok);
        rest = stripped.slice(m[0]!.length).trim();
    }
    // "caixa de jamel" → termo de busca "jamel" (CX é hint, não o produto)
    rest = rest.replace(PACK_LEAD_RE, "").trim() || rest;
    const n = normalizePendingTerm(rest);
    if (isNoiseSegment(n)) return null;
    return { rawTerm: rest, quantity };
}

/**
 * Seed conservador: 2+ segmentos via " e " / vírgula / " mais " **ou**
 * qty justapostas ("duas X tres Y"). Preserva quantity do segmento.
 */
export function extractCandidatePendingTermsFromUserText(userText: string): LexicalCandidateTerm[] {
    const raw = String(userText ?? "").trim();
    if (!raw) return [];
    const parts = raw
        .split(/\s*(?:,|;|\be\b|\bmais\b|\btamb[eé]m\b|\btb\b)\s+/i)
        .flatMap((p) => splitOnJuxtaposedQuantities(p))
        .map((p) => parseProductSegment(p))
        .filter((p): p is LexicalCandidateTerm => p != null);
    if (parts.length < 2) return [];
    return uniqueLexicalTerms(parts);
}

/**
 * Resposta curta de pick/qty/sigla — não deve (re)semeiar worklist
 * (ex.: "3", "caixa", "2 un" enquanto clarify está aberto).
 */
export function isLikelyPickOrShortReply(userText: string): boolean {
    const raw = String(userText ?? "").trim();
    if (!raw) return true;
    if (raw.length > 48) return false;
    const n = normalizePendingTerm(raw);
    if (!n) return true;
    if (/^\d{1,2}$/.test(n)) return true;
    if (PACK_ONLY_RE.test(n)) return true;
    if (FULFILLMENT_OR_PAYMENT_RE.test(n)) return true;
    /** "quero a 2" / "a unidade" / "a caixa" */
    if (/^(a|o|uma|um)\s+(caixa|caixas|unidade|unidades|un|cx|fardo|pacote)s?$/.test(n)) {
        return true;
    }
    const tokens = n.split(" ").filter(Boolean);
    if (tokens.length <= 2 && tokens.every((t) => /^\d+$/.test(t) || QTY_LIKE_SHORT.has(t) || PACK_TOKEN.has(t))) {
        return true;
    }
    return false;
}

const QTY_LIKE_SHORT = new Set([
    "um",
    "uma",
    "dois",
    "duas",
    "tres",
    "três",
    "quatro",
    "cinco",
]);

const PACK_TOKEN = new Set([
    "caixa",
    "caixas",
    "unidade",
    "unidades",
    "un",
    "cx",
    "fardo",
    "fardos",
    "pacote",
    "pacotes",
    "lata",
    "latas",
]);
