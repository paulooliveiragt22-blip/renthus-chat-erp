/**
 * lib/chatbot/parsers/RegexParser.ts
 *
 * Parser nível 2: wrapper ao redor do OrderParserService (Regex + Fuse.js).
 * Mantém toda a lógica existente; apenas expõe como função autônoma.
 *
 * Também expõe extractProductRequests para o fluxo de validação de embalagens.
 */

import { getOrderParserService } from "../OrderParserService";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";
import { normalizeSigla } from "./ProductMatcher";

export async function parseWithRegex(
    input: string,
    products: ProductForSearch[]
): Promise<ParseIntentResult> {
    const parser = getOrderParserService();
    return parser.parseIntent(input, products, { validateAddressWithGoogle: true });
}

// ─── Extração de pedido explícito ────────────────────────────────────────────

export interface ExtractedRequest {
    quantidade: number;
    sigla:      string | null;
    produto:    string;
}

const SIGLA_ALTS = "cx|caixa|cxa|un|unid|unidade|fard|fardo|fd|pct|pac|pack|pacote";
const QTY_ALTS   = "\\d+|um[a]?|dois?|duas?|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez";

const NUMERIC_WORDS: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2,
    tres: 3, quatro: 4, cinco: 5, seis: 6,
    sete: 7, oito: 8, nove: 9, dez: 10,
};

/**
 * Tenta extrair pedidos explícitos com quantidade do input do cliente.
 * Padrão: `<qty> [<sigla>] <produto>`
 * Retorna null se nenhum padrão for encontrado.
 *
 * Exemplos:
 *   "2 heineken"          → [{ quantidade: 2, sigla: null, produto: "heineken" }]
 *   "3 cx brahma"         → [{ quantidade: 3, sigla: "CX", produto: "brahma" }]
 *   "1 caixa skol 350ml"  → [{ quantidade: 1, sigla: "CX", produto: "skol 350ml" }]
 */
export function extractProductRequests(input: string): ExtractedRequest[] | null {
    const re = new RegExp(
        `(${QTY_ALTS})\\s+(?:(${SIGLA_ALTS})\\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ]{0,29})`,
        "gi"
    );

    const results: ExtractedRequest[] = [];

    for (const m of input.matchAll(re)) {
        const qtyText  = m[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
        const siglaRaw = m[2];
        const prodRaw  = (m[3] ?? "")
            .replace(/\s+(pra|para|pro|por|de|do|da|com|em|no|na)\s*$/i, "")
            .trim();

        // Rejeita produto muito curto ou composto só de palavras com < 3 chars
        if (prodRaw.length < 2 || !prodRaw.split(/\s+/).some((w) => w.length >= 3)) continue;

        const qty = NUMERIC_WORDS[qtyText] ?? parseInt(qtyText, 10);
        if (isNaN(qty) || qty <= 0 || qty > 999) continue;

        results.push({
            quantidade: qty,
            sigla:      siglaRaw ? normalizeSigla(siglaRaw) : null,
            produto:    prodRaw,
        });
    }

    return results.length > 0 ? results : null;
}
