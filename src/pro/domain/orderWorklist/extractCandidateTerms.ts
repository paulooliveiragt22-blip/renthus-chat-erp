/**
 * Fallback lexical multi-item (ADR 0011 D4) — NÃO é fonte canônica da worklist.
 * Usado quando extract LLM falha/vazio **ou** devolve menos itens que o lexical
 * (merge no seed — evita selar só o último termo ambíguo).
 */

const MAX_PENDING_TERMS = 5;

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
    "um",
    "uma",
    "uns",
    "umas",
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

/** Qty word/digit that starts a new product chunk mid-phrase (sem "e"/vírgula). */
const QTY_START_RE = /(?:\d+|um|uma|uns|umas|dois|duas|tres|três)/i;

export function normalizePendingTerm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Dois rótulos referem o mesmo produto (query vs menção). */
export function pendingTermsReferToSame(a: string, b: string): boolean {
    const na = normalizePendingTerm(a);
    const nb = normalizePendingTerm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
    return false;
}

function uniquePendingTerms(terms: readonly string[]): string[] {
    const out: string[] = [];
    for (const raw of terms) {
        const t = String(raw ?? "").trim();
        if (!t) continue;
        if (out.some((x) => pendingTermsReferToSame(x, t))) continue;
        out.push(t);
        if (out.length >= MAX_PENDING_TERMS) break;
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

/**
 * "duas skol tres caixa de jamel" → ["duas skol", "tres caixa de jamel"]
 * Parte em qty words/dígitos no meio (smoke Ferrester sem "e" entre itens).
 */
export function splitOnJuxtaposedQuantities(segment: string): string[] {
    const raw = String(segment ?? "").trim();
    if (!raw) return [];
    const parts = raw.split(
        new RegExp(`(?<=\\S)\\s+(?=${QTY_START_RE.source}\\s+\\S)`, "i")
    );
    return parts.map((p) => p.trim()).filter(Boolean);
}

function normalizeProductSegment(segment: string): string {
    let s = stripFillerPrefix(segment);
    s = s.replace(/^(?:\d+|um|uma|dois|duas|tres|três)\s+/i, "").trim();
    return s;
}

/**
 * Seed conservador: 2+ segmentos via " e " / vírgula / " mais " **ou**
 * qty justapostas ("duas X tres Y"). Evita semear em "quero skol" sozinho.
 */
export function extractCandidatePendingTermsFromUserText(userText: string): string[] {
    const raw = String(userText ?? "").trim();
    if (!raw) return [];
    const conjunctionParts = raw
        .split(/\s*(?:,|;|\be\b|\bmais\b|\btamb[eé]m\b|\btb\b)\s+/i)
        .flatMap((p) => splitOnJuxtaposedQuantities(p))
        .map((p) => normalizeProductSegment(p))
        .filter((p) => {
            const n = normalizePendingTerm(p);
            return !isNoiseSegment(n);
        });
    if (conjunctionParts.length < 2) return [];
    return uniquePendingTerms(conjunctionParts);
}
