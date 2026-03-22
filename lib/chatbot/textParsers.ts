/**
 * lib/chatbot/textParsers.ts
 *
 * Funções de parsing de texto livre: extração de endereço, nome do cliente,
 * quantidade, termos de busca, intenções de remoção, método de pagamento, etc.
 */

import type { AddressMatch, VariantRow } from "./types";
import { normalize, STOPWORDS, QUANTITY_WORDS_NORM } from "./utils";

// ─── Regex de módulo ──────────────────────────────────────────────────────────
const PAY_1_RE         = /^\s*1\s*$/u;
const PAY_2_RE         = /^\s*2\s*$/u;
const PAY_3_RE         = /^\s*3\s*$/u;
const PIX_RE           = /\bpix\b/iu;
const CARD_RE          = /\b(cartao|cartão|card|credito|crédito|debito|débito|maquina|maquininha)\b/iu;
const CASH_RE          = /\b(dinheiro|cash|especie|espécie)\b/iu;
const VOL_WORD_RE      = /\b(ml|litro|litros|kg|cx|caixa|fardo|pac|lata)\b/iu;
const VOL_NUM_RE       = /\d+\s*(ml|l|kg|litro)/iu;
const REMOVE_INTENT_RE = /\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/iu;
const GREET_STRIP_RE   = /^(bom\s+dia|boa\s+tarde|boa\s+noite|oi+|ol[aá]|e\s*a[ií]|ei+|hey|hello|opa)[,!\s]+/iu;
const POLITE_STRIP_RE  = /[\s,]*(por\s+favor|pfv+|pf|obrigad[oa]|obg|valeu|vlw)\s*[!.,]?\s*$/iu;

// ─── Endereço ─────────────────────────────────────────────────────────────────

/**
 * Extrai endereço de entrega de mensagem livre usando regex.
 *
 * Captura:
 *   (rua|av|avenida|...) <nome da rua> [,] (nº|n|nro)? <número>
 *
 * Depois tenta capturar o bairro como bloco de palavras após o número.
 */
export function extractAddressFromText(input: string): AddressMatch | null {
    // Padrão principal — captura prefixo + nome + número
    const ADDR_RE = /\b(rua|r\.?|av\.?|avenida|alameda|travessa|trav\.?|estrada|rodovia|pra[cç]a|p[cç][ao]\.?|beco|viela|setor|quadra|qd\.?)\s+([\wÀ-úÀ-ÿ]+(?:\s+[\wÀ-úÀ-ÿ]+){0,8}?)[\s,]*(?:n[º°oa]?\.?\s*)?(\d{1,5})\b/iu;

    const m = input.match(ADDR_RE);
    if (!m) return null;

    const prefix      = m[1].trim();
    const streetName  = m[2].trim().replace(/,+$/, "").trim();
    const houseNumber = m[3];
    const rawSlice    = m[0];

    // Tenta capturar bairro: texto após o número e possível vírgula/hífen/espaço
    const afterAddr = input.slice(input.indexOf(rawSlice) + rawSlice.length).trim();
    // Bairro = 1ª sequência de palavras (até vírgula, ponto, ou fim)
    const neighMatch = afterAddr.match(/^[\s,\-–]+([A-Za-zÀ-úÀ-ÿ][\wÀ-úÀ-ÿ]*(?:\s+[\wÀ-úÀ-ÿ]+){0,8}?)(?:[,;.]|$)/iu);
    const neighborhood = neighMatch ? neighMatch[1].trim() : null;

    const street = `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()} ${streetName}`;
    const full   = neighborhood
        ? `${street}, ${houseNumber} - ${neighborhood}`
        : `${street}, ${houseNumber}`;

    return { street, houseNumber, neighborhood, full, rawSlice };
}

/** Detecta endereço parcial (ex: "na rua X" sem número) para interceptor global */
export function detectAddressAnywhere(input: string): AddressMatch | { full: string; rawSlice: string } | null {
    const m = extractAddressFromText(input);
    if (m) return m;
    const fallback = input.match(/\b(?:na|no)\s+(?:rua|r\.?|av\.?|avenida)\s+([\wÀ-úÀ-ÿ]+(?:[\s,]+[\wÀ-úÀ-ÿ]+){0,12}?)(?:\s*$|[.,]|$)/iu);
    if (fallback) {
        const raw = fallback[0].trim();
        return { full: raw.replace(/^(?:na|no)\s+/i, "").trim(), rawSlice: raw };
    }
    return null;
}

export function detectMultipleAddresses(input: string): string[] | null {
    const ADDR_RE = /\b(?:rua|r\.?|av\.?|avenida|alameda|travessa|estrada|rodovia|pra[cç]a|setor|quadra)\s+[\wÀ-úÀ-ÿ]+(?:\s+[\wÀ-úÀ-ÿ]+){0,8}?\s+\d{1,5}\b/giu;
    const matches = input.match(ADDR_RE);
    if (matches && matches.length >= 2) return matches;
    return null;
}

// ─── Nome do cliente ──────────────────────────────────────────────────────────

export function extractClientName(input: string): string | null {
    const m = input.match(/(?:sou o?a?\s+|me chamo\s+|meu nome [eé]\s+|chamo\s+|pode me chamar de\s+)([A-Za-zÀ-ú][a-zà-ú]*(?:\s+[A-Za-zÀ-ú][a-zà-ú]*)*)/i);
    if (!m) return null;
    const name = m[1].trim();
    // Capitalize first letter of each word
    return name.replace(/\b([a-zà-ú])/gu, (c) => c.toUpperCase());
}

// ─── Quantidade ───────────────────────────────────────────────────────────────

/**
 * Extrai quantidade numérica de uma lista de termos.
 * Returns { qty, terms } where terms has the number removed.
 */
export function extractQuantity(terms: string[]): { qty: number; terms: string[] } {
    let qty = 1;
    const rest: string[] = [];
    for (const t of terms) {
        const wordQty = QUANTITY_WORDS_NORM[t];
        if (typeof wordQty === "number") {
            qty = wordQty;
            continue;
        }

        const n = parseInt(t, 10);
        if (!isNaN(n) && n >= 1 && n <= 99 && /^\d+$/u.test(t)) {
            qty = n;
            continue;
        }

        rest.push(t);
    }
    return { qty, terms: rest };
}

// ─── Extração de termos ───────────────────────────────────────────────────────

/**
 * Remove stopwords e retorna os termos relevantes.
 * Ex: "quero 3 skol lata por favor" → ["3","skol","lata"]
 * Ex: "Quero 3 cerveja Skol" → ["3","cerveja","skol"]
 */
export function extractTerms(input: string): string[] {
    const words = normalize(input).split(/[\s,;:!?]+/u);
    return words.filter((w) => {
        if (!w) return false;
        const isQtyToken = /^\d+$/u.test(w) || Object.prototype.hasOwnProperty.call(QUANTITY_WORDS_NORM, w);
        if (!isQtyToken && w.length < 2) return false;
        // Quantidades (ex: "um", "tres") devem passar mesmo estando em STOPWORDS.
        if (STOPWORDS.has(w) && !isQtyToken) return false;
        return true;
    });
}

// ─── Split de múltiplos itens ─────────────────────────────────────────────────

/**
 * Divide a mensagem em partes por separadores comuns de pedido múltiplo.
 * Ex: "2 skol e 1 gelo" → ["2 skol", "1 gelo"]
 * Ex: "brahma, skol + carvao" → ["brahma", "skol", "carvao"]
 */
export function splitMultiItems(input: string): string[] {
    return input
        .split(/\s+e\s+|\s*\+\s*|\s*,\s*|\s+mais\s+|\s+com\s+/u)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

// ─── Detecção de intenções ────────────────────────────────────────────────────

export function detectRemoveIntent(input: string): boolean {
    return REMOVE_INTENT_RE.test(input);
}

/**
 * Detecta forma de pagamento em texto livre (case insensitive).
 * Trata variações como "pix", "no pix", "vai ser no cartão", "1" (cartão), "2" (pix), "3" (dinheiro).
 * Retorna "pix" | "card" | "cash" ou null.
 */
export function detectPaymentMethod(input: string): "pix" | "card" | "cash" | null {
    const n = normalize(input).trim();
    if (!n) return null;

    // Only detect numbers as payment IF they're alone (not mixed with product text)
    // i.e., the ENTIRE message is just "1", "2", or "3"
    if (PAY_1_RE.test(input)) return "card";
    if (PAY_2_RE.test(input)) return "pix";
    if (PAY_3_RE.test(input)) return "cash";

    if (PIX_RE.test(input)) return "pix";
    if (CARD_RE.test(input)) return "card";
    if (CASH_RE.test(input)) return "cash";

    return null;
}

// ─── Clues de volume ──────────────────────────────────────────────────────────

export function hasVolumeClue(text: string): boolean {
    return VOL_WORD_RE.test(text) || VOL_NUM_RE.test(text);
}

// ─── Limpeza para IA ──────────────────────────────────────────────────────────

/**
 * Layer 2: Remove ruídos antes de enviar ao Claude.
 * Elimina saudações no início e cortesias no fim para economizar tokens
 * e melhorar a precisão da extração de produto/quantidade.
 */
export function cleanInputForAI(input: string): string {
    const s = input
        .replace(GREET_STRIP_RE, "")
        .replace(POLITE_STRIP_RE, "")
        .trim();
    return s || input;
}

// ─── Score de busca ───────────────────────────────────────────────────────────

/**
 * Verifica se um termo de busca bate com o produto.
 * Retorna 2 = match no nome/marca (prioridade alta), 1 = match nas tags/detalhes, 0 = sem match.
 */
export function matchScore(term: string, productName: string, tags: string | null): 0 | 1 | 2 {
    const t = normalize(term);
    if (!t) return 0;
    // prioridade 1: nome do produto
    if (normalize(productName).includes(t)) return 2;
    // prioridade 2: tags (sinônimos separados por vírgula)
    if (tags) {
        const synonyms = tags.split(",").map((s) => normalize(s.trim()));
        if (synonyms.some((s) => s.includes(t) || t.includes(s))) return 1;
    }
    return 0;
}

// ─── Filtros de variante ──────────────────────────────────────────────────────

/**
 * Filtra variantes pelo tipo de embalagem solicitado pelo cliente.
 * Retorna { filtered, wasFiltered }.
 *
 * - packagingSigla = null → sem filtro (retorna todas)
 * - packagingSigla = "CX"/"FARD"/"PAC" → apenas variantes que têm embalagem bulk
 * - packagingSigla = "UN" → retorna todas (UN sempre disponível)
 *
 * Fallback: se nenhuma variante satisfaz o filtro, retorna todas + wasFiltered=false
 * para que o bot possa informar ao cliente que a embalagem pedida não está disponível.
 */
export function filterVariantsByPackaging(
    variants: VariantRow[],
    packagingSigla: string | null
): { filtered: VariantRow[]; wasFiltered: boolean } {
    if (!packagingSigla || packagingSigla === "UN") {
        return { filtered: variants, wasFiltered: false };
    }
    // Bulk: só produtos que possuem a embalagem bulk cadastrada
    const withBulk = variants.filter((v) => v.hasCase);
    if (withBulk.length > 0) {
        return { filtered: withBulk, wasFiltered: true };
    }
    // Nenhum produto tem bulk cadastrado → fallback para todos
    return { filtered: variants, wasFiltered: false };
}

/** Remove o prefixo da categoria do nome do produto (case-insensitive). */
export function stripCategoryPrefix(productName: string, categoryName: string): string {
    const lower = normalize(productName);
    const cat   = normalize(categoryName);
    if (lower.startsWith(cat + " ")) return productName.slice(categoryName.length).trim();
    return productName;
}
