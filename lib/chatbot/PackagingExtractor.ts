/**
 * PackagingExtractor
 *
 * Extrai do texto livre:
 *   - Intenção de embalagem do cliente (CX, FARD, PAC, UN)
 *   - Quantidade
 *   - Texto limpo para busca de produto
 *
 * Deve ser chamado ANTES do Fuse.js / searchVariants,
 * para que o termo de embalagem não contamine a busca.
 *
 * @example
 * extractPackagingIntent("6 cx de heineken")
 * // → { packagingSigla: "CX", qty: 6, cleanText: "heineken", isExplicit: true }
 *
 * extractPackagingIntent("2 caixinhas de skol")
 * // → { packagingSigla: "CX", qty: 2, cleanText: "skol", isExplicit: true }
 *
 * extractPackagingIntent("heineken 600ml")
 * // → { packagingSigla: null, qty: 1, cleanText: "heineken 600ml", isExplicit: false }
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PackagingIntent {
    /** Sigla do banco (CX, FARD, PAC, UN) ou null quando não detectado */
    packagingSigla: string | null;
    /** Quantidade solicitada (≥ 1) */
    qty: number;
    /** Texto sem o token de embalagem e sem a quantidade, pronto para busca */
    cleanText: string;
    /** true = cliente explicitou a embalagem, false = inferido ou ausente */
    isExplicit: boolean;
}

// ─── Mapa de aliases → sigla ──────────────────────────────────────────────────
//
// Regra da região (Sorriso-MT / conveniência delivery):
//   "fardinho" → CX  (fardo pequeno = caixa de 12-24un para o cliente)
//   "caixinha" → CX  (idem)
//   "fardo"    → FARD (embalagem de atacado, pouco usada mas cadastrada)
//   "pacote"   → PAC
//
// IMPORTANTE: chaves em minúsculas sem acento (depois de normalize()).

const PACKAGING_ALIASES: Record<string, string> = {
    // ── CX ────────────────────────────────────────────────────────────────────
    "cx":        "CX",
    "caixa":     "CX",
    "caixas":    "CX",
    "caixinha":  "CX",   // pedido regional comum
    "caixinhas": "CX",
    "fardinho":  "CX",   // fardo pequeno → equivalente a caixa no contexto local
    "fardinhos": "CX",

    // ── FARD ──────────────────────────────────────────────────────────────────
    "fardo":   "FARD",
    "fardos":  "FARD",
    "fard":    "FARD",

    // ── PAC ───────────────────────────────────────────────────────────────────
    "pacote":   "PAC",
    "pacotes":  "PAC",
    "pac":      "PAC",
    "pct":      "PAC",

    // ── UN ────────────────────────────────────────────────────────────────────
    "unidade":  "UN",
    "unidades": "UN",
    "und":      "UN",
    // "un" omitido intencionalmente: é muito curto e colide com sílabas de palavras
};

// ─── Palavras numéricas (mesmas do processMessage / OrderParserService) ────────

const QUANTITY_WORDS: Record<string, number> = {
    "um": 1, "uma": 1,
    "dois": 2, "duas": 2,
    "tres": 3,
    "quatro": 4,
    "cinco": 5,
    "seis": 6,
    "sete": 7,
    "oito": 8,
    "nove": 9,
    "dez": 10,
    "onze": 11,
    "doze": 12,
    "treze": 13,
    "catorze": 14,
    "quinze": 15,
    "vinte": 20,
    "trinta": 30,
    "quarenta": 40,
    "cinquenta": 50,
};

// Verbos de pedido que precedem a quantidade
const LEADING_VERBS_RE = /\b(quero|quer|manda|mande|traga|trazer|por favor|pf|me\s+da|me\s+de|bota|bota ai)\s+/gi;

// Preposições que costumam ligar embalagem ao produto ("cx DE heineken", "fardo DA skol")
const PREP_RE = /^\s*(de|do|da|dos|das|of)\s+/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

/** Remove múltiplos espaços internos */
function collapseSpaces(s: string): string {
    return s.replace(/\s{2,}/g, " ").trim();
}

// ─── Extração principal ───────────────────────────────────────────────────────

/**
 * Extrai intenção de embalagem, quantidade e texto limpo de uma mensagem.
 *
 * Padrões reconhecidos (em ordem de prioridade):
 *
 * 1. Número + alias antes do produto:
 *    "6 cx de heineken"    → qty=6, sigla=CX, clean="heineken"
 *    "2 caixinhas skol"    → qty=2, sigla=CX, clean="skol"
 *    "manda 1 fardinho brahma" → qty=1, sigla=CX, clean="brahma"
 *
 * 2. Alias sozinho antes do produto (sem número):
 *    "cx heineken"         → qty=1, sigla=CX, clean="heineken"
 *    "caixa de skol"       → qty=1, sigla=CX, clean="skol"
 *
 * 3. Alias no final (pós-produto):
 *    "heineken caixa"      → qty=1, sigla=CX, clean="heineken"
 *    "skol em caixa"       → qty=1, sigla=CX, clean="skol"
 *
 * 4. Nenhum alias → packagingSigla=null, cleanText=texto original (sem verbo/qty)
 */
export function extractPackagingIntent(rawText: string): PackagingIntent {
    if (!rawText?.trim()) {
        return { packagingSigla: null, qty: 1, cleanText: "", isExplicit: false };
    }

    // Remove verbos de pedido ("manda", "quero", etc.)
    let text = rawText.trim().replace(LEADING_VERBS_RE, "").trim();
    if (!text) {
        return { packagingSigla: null, qty: 1, cleanText: rawText.trim(), isExplicit: false };
    }

    // ── Padrão 1 & 2: alias ANTES do produto ─────────────────────────────────
    //
    // Captura:  [número? ] [alias] [preposição?] [resto do texto]
    // Ex:  "6 cx de heineken 600ml"
    //      "caixinha skol"
    //      "2 fardos de brahma lata"
    //
    // Regex: ^(\d{1,2}\s+)?(<alias>)\s+(<preposição opcional>)?(.+)$
    //
    // Construímos dinamicamente com as chaves do mapa, da maior para a menor
    // (para "caixinhas" ser testado antes de "caixa").
    const aliasKeys = Object.keys(PACKAGING_ALIASES).sort((a, b) => b.length - a.length);
    const aliasPattern = aliasKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

    // Padrão 1+2: ALIAS vem antes do produto (com ou sem número)
    const reBefore = new RegExp(
        `^(\\d{1,2}\\s+)?(${aliasPattern})\\b\\s+(.+)$`,
        "i"
    );
    const mBefore = normalize(text).match(reBefore);

    if (mBefore) {
        const rawQtyStr = mBefore[1]?.trim() ?? null;
        const aliasRaw  = normalize(mBefore[2]);
        const rest      = mBefore[3].trim().replace(PREP_RE, "").trim(); // remove "de/da" inicial

        const sigla = PACKAGING_ALIASES[aliasRaw] ?? null;
        if (sigla) {
            const qty = rawQtyStr ? parseInt(rawQtyStr, 10) : parseQuantityWord(rest) ?? 1;
            // Se a quantidade veio de palavra no resto, remove essa palavra do cleanText
            const cleanText = rawQtyStr ? rest : stripLeadingQuantityWord(rest);
            return {
                packagingSigla: sigla,
                qty: Math.max(1, isFinite(qty) ? qty : 1),
                cleanText: collapseSpaces(cleanText),
                isExplicit: true,
            };
        }
    }

    // ── Padrão 3: alias DEPOIS do produto ────────────────────────────────────
    //
    // Ex: "heineken caixa", "skol em caixinha", "brahma fardinho"
    //
    const reAfter = new RegExp(
        `^(.+?)\\s+(?:em\\s+)?(${aliasPattern})\\b\\s*$`,
        "i"
    );
    const mAfter = normalize(text).match(reAfter);

    if (mAfter) {
        const productPart = mAfter[1].trim();
        const aliasRaw    = normalize(mAfter[2]);
        const sigla       = PACKAGING_ALIASES[aliasRaw] ?? null;
        if (sigla) {
            // Extrai quantidade do início do productPart
            const { qty, remainder } = extractLeadingQty(productPart);
            return {
                packagingSigla: sigla,
                qty,
                cleanText: collapseSpaces(remainder),
                isExplicit: true,
            };
        }
    }

    // ── Padrão 4: sem alias → retorna qty + cleanText sem verbo ─────────────
    const { qty, remainder } = extractLeadingQty(normalize(text));
    return {
        packagingSigla: null,
        qty,
        cleanText: collapseSpaces(remainder || normalize(text)),
        isExplicit: false,
    };
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Extrai quantidade do início do texto (número ou palavra por extenso).
 * Retorna { qty, remainder } onde remainder é o texto sem a quantidade.
 */
function extractLeadingQty(text: string): { qty: number; remainder: string } {
    const t = text.trim();

    // Número no início
    const numMatch = t.match(/^(\d{1,2})\s+(.+)$/);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n >= 1 && n <= 99) {
            return { qty: n, remainder: numMatch[2].trim() };
        }
    }

    // Palavra por extenso no início
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
        const re = new RegExp(`^${word}\\b[\\s,.]*(.+)$`, "i");
        const m = t.match(re);
        if (m) {
            return { qty: value, remainder: m[1].trim() };
        }
    }

    return { qty: 1, remainder: t };
}

/**
 * Retorna a quantidade se o texto começa com uma palavra numérica por extenso,
 * ou null se não encontrar.
 */
function parseQuantityWord(text: string): number | null {
    const t = normalize(text).trim();
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
        if (t.startsWith(word + " ") || t === word) return value;
    }
    return null;
}

/**
 * Remove palavra numérica por extenso do início do texto (se houver).
 * Ex: "seis heineken" → "heineken"
 * Ex: "heineken" → "heineken" (sem alteração)
 */
function stripLeadingQuantityWord(text: string): string {
    const t = text.trim();
    for (const [word] of Object.entries(QUANTITY_WORDS)) {
        const re = new RegExp(`^${word}\\b[\\s,.]+(.+)$`, "i");
        const m = t.match(re);
        if (m) return m[1].trim();
    }
    return t;
}

// ─── Utilitário: nome legível da sigla ───────────────────────────────────────

/** Retorna o label para exibir ao cliente (ex: "caixa", "fardo", "pacote", "unidade") */
export function packagingLabel(sigla: string | null): string {
    switch (sigla) {
        case "CX":   return "caixa";
        case "FARD": return "fardo";
        case "PAC":  return "pacote";
        case "UN":   return "unidade";
        default:     return "unidade";
    }
}

/**
 * Retorna true se a sigla representa uma embalagem "bulk" (múltiplas unidades).
 * CX, FARD e PAC são bulk; UN é unitário.
 */
export function isBulkPackaging(sigla: string | null): boolean {
    return sigla === "CX" || sigla === "FARD" || sigla === "PAC";
}
