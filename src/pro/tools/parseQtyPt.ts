import { normalize, QUANTITY_WORDS_NORM } from "@/lib/chatbot/utils";

/** Extensão de erros comuns de escrita + números compostos simples. */
const EXTRA_QTY: Record<string, number> = {
    "tres":   3,
    "dua":    2,
    "duas":   2,
    "catorze": 14,
    "quinze":  15,
    "dezesseis": 16,
    "dezessete": 17,
    "dezoito":   18,
    "dezenove":  19,
    "vinte":     20,
};

function qtyMap(tok: string): number | undefined {
    const n = normalize(tok);
    return EXTRA_QTY[n] ?? QUANTITY_WORDS_NORM[n];
}

/**
 * Interpreta quantidade vinda do modelo ou texto (número, dígitos, ou uma palavra PT).
 * Devolve null se não for possível.
 */
export function parsePtQuantity(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        const q = Math.floor(value);
        return q >= 1 ? q : null;
    }
    if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (!s) return null;
        if (/^\d+$/.test(s)) {
            const q = Number.parseInt(s, 10);
            return q >= 1 ? q : null;
        }
        const n = normalize(s);
        if (/^\d+$/.test(n)) {
            const q = Number.parseInt(n, 10);
            return q >= 1 ? q : null;
        }
        const parts = n.split(/\s+/u).filter(Boolean);
        for (const p of parts) {
            const v = qtyMap(p);
            if (v != null) return v;
        }
        const asNum = Number.parseFloat(s.replaceAll(",", "."));
        if (Number.isFinite(asNum) && asNum >= 1) return Math.floor(asNum);
    }
    return null;
}

/**
 * C3.2 — true se a mensagem do cliente traz quantidade explícita (dígito, por extenso,
 * ou artigo numeral "um/uma"). Alinha force-prepare à regra do system prompt
 * ("não assuma quantity=1").
 */
/** Primeira quantidade explícita no texto do cliente (`2`, `duas`, `uma`) — ordem do texto. */
export function extractExplicitOrderQuantityFromText(text: string): number | null {
    const raw = String(text ?? "").trim();
    if (!raw) return null;
    for (const tok of normalize(raw).split(/\s+/u).filter(Boolean)) {
        if (/^\d{1,3}$/u.test(tok)) {
            const n = Number(tok);
            if (Number.isFinite(n) && n >= 1) return Math.floor(n);
            continue;
        }
        const v = qtyMap(tok);
        if (v != null) return v;
    }
    return null;
}

export function hasExplicitOrderQuantityInText(text: string): boolean {
    return extractExplicitOrderQuantityFromText(text) != null;
}

/** Segmentos de pedido multi-produto (", " / " e " / "também" / "mais"). */
export function splitOrderProductSegments(text: string): string[] {
    return String(text ?? "")
        .split(/\s*(?:,|;|\be\b|\btambém\b|\bmais\b)\s*/giu)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Qty do segmento ligado ao termo de busca (multi-produto).
 * Evita que "3" de "… e 3 heineken" sobrescreva "duas" de "duas caixas de original".
 */
export function extractQuantityNearQuery(query: string, userText: string): number | null {
    const qTokens = normalize(query)
        .split(/\s+/u)
        .filter((t) => t.length >= 3 && !/^\d+$/u.test(t));
    const segments = splitOrderProductSegments(userText);
    if (segments.length && qTokens.length) {
        let best: string | null = null;
        let bestScore = 0;
        for (const seg of segments) {
            const sn = normalize(seg);
            const score = qTokens.filter((t) => sn.includes(t)).length;
            if (score > bestScore) {
                bestScore = score;
                best = seg;
            }
        }
        if (best && bestScore > 0) {
            const fromSeg = extractExplicitOrderQuantityFromText(best);
            if (fromSeg != null) return fromSeg;
        }
    }
    return extractExplicitOrderQuantityFromText(userText);
}
