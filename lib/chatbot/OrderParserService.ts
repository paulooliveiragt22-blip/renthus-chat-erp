/**
 * OrderParserService
 *
 * Extrai intenção de pedido de texto livre: quantidade, produto (via Fuse.js) e endereço.
 * Valida endereços com Google Maps Geocoding API.
 * Integra com Session/chatbot_sessions.
 *
 * @example
 * ```ts
 * const parser = getOrderParserService(process.env.GOOGLE_MAPS_API_KEY);
 * const products = await fetchProductsFromSupabase(companyId); // ProductForSearch[]
 * const result = await parser.parseIntent("2 skol na rua das flores 123", products, {
 *   validateAddressWithGoogle: true,
 * });
 * if (result.action === "confirm_order") {
 *   await saveSession(admin, threadId, companyId, { step: "checkout_confirm", context: result.contextUpdate });
 *   // Adicionar result.items ao cart
 * } else if (result.action === "add_to_cart") {
 *   const newCart = mergeCart(session.cart, parsedItemsToCartItems(result.items));
 *   await saveSession(admin, threadId, companyId, { cart: newCart, context: result.contextUpdate });
 *   if (result.askAddress) await reply(phone, "Qual é o endereço de entrega?");
 * }
 * ```
 */

import Fuse from "fuse.js";
import { Client } from "@googlemaps/google-maps-services-js";
import { extractPackagingIntent, isBulkPackaging } from "@/lib/chatbot/PackagingExtractor";

// ─── Tipos (compatíveis com Session) ─────────────────────────────────────────

export interface CartItem {
    variantId: string;
    productId: string;
    name: string;
    price: number;
    qty: number;
    isCase?: boolean;
    caseQty?: number;
}

export interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, unknown>;
}

/** Produto mínimo para busca Fuse.js */
export interface ProductForSearch {
    id: string;          // variantId (embalagem)
    productId: string;
    productName: string;
    unitPrice: number;
    tags?: string | null;
    details?: string | null;
    volumeValue?: number;
    unit?: string;
    hasCase?: boolean;
    caseQty?: number | null;
    casePrice?: number | null;
    caseVariantId?: string;
}

/** Item parseado: produto + quantidade */
export interface ParsedItem {
    productId:      string;
    variantId:      string;
    name:           string;
    price:          number;
    qty:            number;
    confidence:     number;   // 1 - Fuse score (0–1)
    packagingSigla: string;   // "UN" | "CX" | "FARD" | "PAC"
    isCase:         boolean;  // true quando packagingSigla ≠ "UN"
}

/** Endereço extraído/validado */
export interface ParsedAddress {
    raw: string;
    formatted: string;
    placeId?: string;
    street?: string;
    houseNumber?: string;
    neighborhood?: string;
}

/** Resultado da decisão do parser */
export type ParseIntentResult =
    | { action: "confirm_order"; items: ParsedItem[]; address: ParsedAddress; contextUpdate: Partial<Session["context"]> }
    | { action: "add_to_cart"; items: ParsedItem[]; contextUpdate: Partial<Session["context"]>; askAddress: true }
    | { action: "add_to_cart"; items: ParsedItem[]; contextUpdate: Partial<Session["context"]>; askAddress?: false }
    | { action: "low_confidence"; message: string; confidence: number; contextUpdate?: Partial<Session["context"]> }
    | { action: "product_not_found"; message: string; contextUpdate?: Partial<Session["context"]> }
    | { action: "invalid"; message: string };

// ─── Constantes ─────────────────────────────────────────────────────────────

const QUANTITY_WORDS: Record<string, number> = {
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "três": 3, "quatro": 4,
    "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10,
    "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quinze": 15,
    "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50,
};

const FUSE_THRESHOLD = 0.4;
const CONFIDENCE_MIN = 0.4;
const CONFIDENCE_LOW = 0.3;  // Abaixo disso → low_confidence (fallback inteligente)
const QTY_SANITY_MAX = 20;   // Quantidade > isso gera confirmação ou fallback para 1

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

/** Verbos/palavras de pedido que podem preceder a quantidade (ex: "manda duas heineken") */
const LEADING_VERBS = /\b(quero|quer|manda|mande|traga|trazer|por favor|pf|me\s+da|me\s+de)\s+/gi;

/**
 * Extrai quantidade de um trecho de texto (número ou palavra).
 * PRIORIDADE: palavras por extenso (uma, duas) > dígitos no início.
 * NUNCA usa números que parecem ser de endereço (ex: 86 no final) ou de unidade (600ml).
 */
function extractQuantityFromText(text: string): { qty: number; remainder: string } {
    let t = text.trim();
    if (!t) return { qty: 1, remainder: t };

    // Remove verbos no início (ex: "manda duas heineken" → "duas heineken")
    t = t.replace(LEADING_VERBS, "").trim();
    if (!t) return { qty: 1, remainder: text.trim() };

    let qty = 1;
    let remainder = t;

    // 1) PRIORIDADE: palavras por extenso (um, uma, dois, etc.) — convertem corretamente
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
        const re = new RegExp(`^\\s*${word}\\b[\\s,;:.!?\\-]*\\s+(.+)$`, "i");
        const m = t.match(re);
        if (m) {
            qty = value;
            remainder = m[1].trim();
            return { qty, remainder };
        }
    }
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
        const re = new RegExp(`\\b${word}\\b[\\s,;:.!?\\-]*\\s+(.+)`, "i");
        const m = t.match(re);
        if (m && m[1].trim().length >= 2) {
            qty = value;
            remainder = m[1].trim();
            return { qty, remainder };
        }
    }

    // 2) Dígitos — apenas no INÍCIO (evita pegar número de endereço no final)
    const numStart = t.match(/^\s*(\d{1,2})\s+(.+)$/);
    if (numStart) {
        const n = parseInt(numStart[1], 10);
        if (n >= 1 && n <= 99) {
            qty = n;
            remainder = numStart[2].trim();
            return { qty, remainder };
        }
    }

    // 3) Número no meio — só se NÃO estiver no final (nº de endereço) e for <= QTY_SANITY_MAX
    const numMid = t.match(/(?:^|\s)(\d{1,2})\s+(.+)$/);
    if (numMid && numMid[2].trim().length >= 2) {
        const n = parseInt(numMid[1], 10);
        // Evitar números que parecem de endereço (ex: 86 no final da frase)
        if (n >= 1 && n <= QTY_SANITY_MAX) {
            qty = n;
            remainder = numMid[2].trim();
            return { qty, remainder };
        }
    }

    return { qty: 1, remainder: t };
}

/** Resultado da extração de endereço: endereço formatado + slice exato para remoção */
export interface AddressExtractResult {
    address: string;
    rawSlice: string;  // trecho exato na string original para remover antes de buscar produtos
}

/**
 * Extrai endereço da mensagem usando regex e palavras-chave.
 * PRIORIDADE: primeiro identifica endereço (rua/av/etc + número + bairro/cidade).
 * LIMPEZA RADICAL: rawSlice inclui todo o bloco (logradouro + número + bairro/cidade)
 * para que o restante da string fique vazio quando o usuário só digitou endereço.
 */
function extractAddressFromText(input: string): AddressExtractResult | null {
    const ADDR_RE = /\b(rua|r\.|av\.?|avenida|alameda|travessa|trav\.?|estrada|rodovia|pra[cç]a|p[cç][ao]\.?|beco|viela|setor|quadra|qd\.?)\s+([\wÀ-úÀ-ÿ\s]{2,50}?)[\s,]*(?:n[º°oa]?\.?\s*)?(\d{1,5})\b/i;
    const m = input.match(ADDR_RE);
    if (m) {
        const addrStart = input.indexOf(m[0]);
        const addrEnd = addrStart + m[0].length;
        // NÃO fazer trim: precisamos do espaço antes do bairro para o regex capturar
        const after = input.slice(addrEnd);
        // Bairro/cidade: espaço ou vírgula + sequência de palavras (ex: " São Mateus", " - Centro")
        const neighMatch = after.match(/^[\s,\-–]+([A-Za-zÀ-úÀ-ÿ][A-Za-zÀ-úÀ-ÿ\s]{1,50}?)(?=\s*$|[.,;]|$)/i);
        const neighborhood = neighMatch ? ` - ${neighMatch[1].trim()}` : "";
        const fullAddr = `${m[0]}${neighborhood}`.trim();
        const rawSlice = neighMatch
            ? input.slice(addrStart, addrEnd + neighMatch[0].length).trim()
            : m[0];
        return { address: fullAddr, rawSlice };
    }

    // Fallback: texto após "na rua", "no beco", "na av", etc.
    const afterPrep = input.match(/\b(na|no)\s+(rua|r\.|av\.?|avenida|bairro|beco|viela|travessa|alameda)\s+(.+?)(?:\.|$)/i);
    if (afterPrep) {
        const rawSlice = afterPrep[0];
        return { address: afterPrep[3].trim(), rawSlice };
    }

    const withNum = input.match(/.{10,80}(?:n[º°]\.?\s*|,\s*)\d{1,5}\b[\wÀ-úÀ-ÿ\s\-–]{0,60}?$/i);
    if (withNum) {
        return { address: withNum[0].trim(), rawSlice: withNum[0].trim() };
    }

    return null;
}

/**
 * Divide a mensagem em itens (separadores: e, +, vírgula, mais, com).
 */
function splitMultiItems(input: string): string[] {
    return input
        .split(/\s+e\s+|\s*\+\s*|\s*,\s*|\s+mais\s+|\s+com\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
}

// ─── OrderParserService ─────────────────────────────────────────────────────

export class OrderParserService {
    private fuse: Fuse<ProductForSearch> | null = null;
    private productsCache: ProductForSearch[] = [];
    private mapsClient: Client | null = null;
    private googleApiKey: string | null = null;

    constructor(options?: { googleApiKey?: string }) {
        this.googleApiKey = options?.googleApiKey ?? process.env.GOOGLE_MAPS_API_KEY ?? null;
        if (this.googleApiKey) {
            this.mapsClient = new Client({});
        }
    }

    /**
     * Configura a lista de produtos para busca (Fuse.js).
     * Deve ser chamado antes de parseIntent quando a lista mudar.
     */
    setProducts(products: ProductForSearch[]): void {
        this.productsCache = products;
        this.fuse = new Fuse(products, {
            keys: [
                { name: "productName", weight: 0.6 },
                { name: "tags", weight: 0.3 },
                { name: "details", weight: 0.1 },
            ],
            threshold: FUSE_THRESHOLD,
            includeScore: true,
        });
    }

    /**
     * Busca produto por texto usando Fuse.js.
     * Retorna o melhor match com confidence (1 - score).
     * Se includeLowConfidence, retorna mesmo com confidence < CONFIDENCE_MIN (para low_confidence).
     */
    private findProduct(searchText: string, includeLowConfidence = false): { product: ProductForSearch; confidence: number } | null {
        if (!this.fuse || !searchText.trim()) return null;

        const results = this.fuse.search(searchText, { limit: 1 });
        if (!results.length) return null;

        const [best] = results;
        const score = best.score ?? 1;
        const confidence = 1 - score;

        if (!includeLowConfidence && confidence < CONFIDENCE_MIN) return null;
        if (confidence < 0.05) return null;

        return { product: best.item, confidence };
    }

    /**
     * Remove números que fazem parte de unidades de medida (600ml, 350g) do texto de busca.
     * Evita que "600" seja interpretado como quantidade quando o produto é "Heineken 600ml".
     */
    private stripUnitMeasuresFromSearch(text: string): string {
        return text.replace(/\d+(?:\.\d+)?\s*(?:ml|g|kg|l|lt|litro|unidade|un)\b/gi, " ").replace(/\s+/g, " ").trim();
    }

    /**
     * Extrai itens (produto + qty + embalagem) de um trecho de texto.
     *
     * ORDEM:
     *   1. extractPackagingIntent → detecta "cx", "caixa", "caixinha", "fardinho", etc.
     *   2. Busca produto no cleanText via Fuse.js
     *   3. Se embalagem bulk e produto tem casePrice → usa casePrice + caseVariantId
     *
     * Sanity: qty > QTY_SANITY_MAX → usa 1 (número de endereço).
     */
    private extractItems(text: string, includeLowConfidence = false): ParsedItem[] {
        const items: ParsedItem[] = [];
        const parts = splitMultiItems(text);

        for (const part of parts) {
            // Extrai intenção de embalagem E quantidade do trecho
            const pkgIntent = extractPackagingIntent(part);
            const { qty: rawQty, packagingSigla, cleanText } = pkgIntent;

            // Usa o cleanText (sem token de embalagem) para buscar o produto
            const searchBase = cleanText || part;
            if (!searchBase || searchBase.trim().length < 2) continue;

            // Remove medidas de unidade (600ml, 350g) que não são embalagem
            const searchText = this.stripUnitMeasuresFromSearch(searchBase);
            const found = this.findProduct(searchText || searchBase, includeLowConfidence);
            if (!found) continue;

            // Sanity: quantidade muito alta provavelmente é número de endereço
            let qty = rawQty;
            if (qty > QTY_SANITY_MAX) qty = 1;

            const p = found.product;

            // Decide se é venda bulk (CX/FARD/PAC) e produto suporta
            const wantsBulk = isBulkPackaging(packagingSigla) && Boolean(p.hasCase);
            const isCase    = wantsBulk;

            // Monta label de volume
            const volLabel = p.volumeValue
                ? ` ${p.volumeValue}${p.unit ? p.unit : ""}`.trim()
                : "";
            let name = `${p.productName}${volLabel}`.trim();
            if (isCase && p.caseQty) {
                name = `${name} (cx ${p.caseQty}un)`;
            }

            // Preço e variantId dependem da embalagem
            const price     = isCase ? (p.casePrice ?? p.unitPrice) : p.unitPrice;
            const variantId = isCase ? (p.caseVariantId ?? p.id) : p.id;

            items.push({
                productId:      p.productId,
                variantId,
                name,
                price,
                qty,
                confidence:     found.confidence,
                packagingSigla: packagingSigla ?? "UN",
                isCase,
            });
        }

        return items;
    }

    /**
     * Remove o trecho de endereço do texto antes de buscar produtos no Fuse.js.
     * LIMPEZA RADICAL: remove todo o bloco de endereço incluindo bairro/cidade.
     * A string resultante deve ser vazia se o usuário só digitou endereço.
     */
    private removeAddressFromText(text: string, rawSlice: string): string {
        const lower = text.toLowerCase();
        const sliceLower = rawSlice.toLowerCase();

        const stripTrailingPrepositions = (s: string): string => {
            let out = (s ?? "").trim();
            // Remove preposições que podem sobrar no final após recorte do endereço:
            // "manda duas heineken na rua ... " → "manda duas heineken na"
            // Queremos o texto final para busca ser só o nome do produto.
            for (let i = 0; i < 3; i++) {
                const next = out.replace(/\b(na|no|em|para)\b[\s,;:.!?-]*$/i, "").trim();
                if (!next) return "";
                if (next === out) break;
                out = next;
            }
            return out;
        };

        let idx = lower.indexOf(sliceLower);
        if (idx >= 0) {
            const before = text.slice(0, idx).trim();
            const after = text.slice(idx + rawSlice.length).trim();
            return stripTrailingPrepositions([before, after].filter(Boolean).join(" ").trim());
        }
        const candidates = [
            "na " + rawSlice,
            "no " + rawSlice,
            rawSlice,
            rawSlice.replace(" - ", " "),
            rawSlice.replace(/ - /g, " "),
        ];
        for (const toRemove of candidates) {
            const i = lower.indexOf(toRemove.toLowerCase());
            if (i >= 0) {
                const before = text.slice(0, i).trim();
                const after = text.slice(i + toRemove.length).trim();
                return stripTrailingPrepositions([before, after].filter(Boolean).join(" ").trim());
            }
        }
        return text;
    }

    /**
     * Valida endereço com Google Maps Geocoding API.
     * Retorna endereço formatado e place_id.
     */
    async validateAddress(text: string): Promise<ParsedAddress | null> {
        if (!this.mapsClient || !this.googleApiKey || !text.trim()) {
            return { raw: text.trim(), formatted: text.trim() };
        }

        console.log("[OrderParserService] Chamando API do Google Geocoding para:", text.trim());

        try {
            const res = await this.mapsClient.geocode({
                params: {
                    address: `${text.trim()}, Brazil`,
                    key: this.googleApiKey!,
                    // Restringe a busca geográfica para evitar sugestões fora da região (ex: SP).
                    // Localidade: Sorriso (MT)
                    components: "country:BR|administrative_area:MT|locality:Sorriso",
                },
            });

            const result = res.data.results?.[0];
            if (!result) return null;

            const formatted = result.formatted_address ?? text.trim();
            const comps = result.address_components ?? [];

            const getComp = (types: string[]) =>
                comps.find((c) => types.some((t) => (c.types as readonly string[]).includes(t)))?.long_name;

            return {
                raw: text.trim(),
                formatted,
                placeId: result.place_id,
                street: getComp(["route"]) ?? undefined,
                houseNumber: getComp(["street_number"]) ?? undefined,
                neighborhood: getComp(["sublocality", "neighborhood"]) ?? undefined,
            };
        } catch (err) {
            console.error("[OrderParserService] validateAddress error:", err);
            return { raw: text.trim(), formatted: text.trim() };
        }
    }

    /**
     * Função principal: parseia a mensagem e retorna a decisão.
     */
    async parseIntent(
        text: string,
        productsList: ProductForSearch[],
        options?: { validateAddressWithGoogle?: boolean }
    ): Promise<ParseIntentResult> {
        this.setProducts(productsList);

        const raw = text.trim();
        if (!raw || raw.length < 2) {
            return { action: "invalid", message: "Mensagem muito curta." };
        }

        // 1) PRIORIDADE: extrair endereço primeiro (rua, av, etc.) e remover da string
        //    antes de mandar o restante para o Fuse.js buscar produtos (evita buscar "rua" como produto)
        const addrExtract = extractAddressFromText(raw);
        let parsedAddress: ParsedAddress | null = null;

        if (addrExtract) {
            console.log("[OrderParserService] Endereço identificado:", addrExtract.address, "| rawSlice:", addrExtract.rawSlice);
            if (options?.validateAddressWithGoogle && this.mapsClient) {
                parsedAddress = await this.validateAddress(addrExtract.address);
            } else {
                parsedAddress = { raw: addrExtract.address, formatted: addrExtract.address };
            }
        }

        // 2) Remover endereço do texto e enviar só o restante para busca de produtos
        const textAfterAddr = addrExtract
            ? this.removeAddressFromText(raw, addrExtract.rawSlice)
            : raw;

        // 2b) Extrair intenção de embalagem do texto sem endereço
        //     (ex: "6 cx de heineken" → packagingSigla=CX, cleanText="heineken")
        const pkgIntent      = extractPackagingIntent(textAfterAddr);
        const textForProducts = pkgIntent.cleanText || textAfterAddr;

        if (textForProducts.trim()) {
            console.log("[OrderParserService] Texto para busca de produtos (após remover endereço + embalagem):", textForProducts.trim());
            if (pkgIntent.packagingSigla) {
                console.log("[OrderParserService] Embalagem detectada:", pkgIntent.packagingSigla, "| qty:", pkgIntent.qty);
            }
        }

        if (!textForProducts.trim()) {
            if (parsedAddress) {
                const ctx: Partial<Session["context"]> = {
                    delivery_address: parsedAddress.formatted,
                    delivery_address_place_id: parsedAddress.placeId,
                    askAddress: false,
                };
                if (parsedAddress.neighborhood) ctx.delivery_neighborhood = parsedAddress.neighborhood;
                return {
                    action: "add_to_cart",
                    items: [],
                    contextUpdate: ctx,
                    askAddress: false,
                };
            }
            return { action: "invalid", message: "Não identifiquei produtos nem endereço." };
        }

        // 3) Extrair itens (produto + quantidade)
        const items = this.extractItems(textForProducts);

        if (!items.length) {
            const lowConfItems = this.extractItems(textForProducts, true);
            const best = lowConfItems[0];
            if (best && best.confidence >= 0.05 && best.confidence < CONFIDENCE_LOW) {
                return {
                    action: "low_confidence",
                    message: `Não tenho certeza do produto _"${textForProducts}"_.`,
                    confidence: best.confidence,
                    contextUpdate: parsedAddress ? {
                        delivery_address: parsedAddress.formatted,
                        delivery_address_place_id: parsedAddress.placeId,
                        ...(parsedAddress.neighborhood ? { delivery_neighborhood: parsedAddress.neighborhood } : {}),
                    } : undefined,
                };
            }
            return {
                action: "product_not_found",
                message: `Não consegui identificar o produto em _"${textForProducts}"_.`,
                contextUpdate: parsedAddress ? {
                    delivery_address: parsedAddress.formatted,
                    delivery_address_place_id: parsedAddress.placeId,
                    ...(parsedAddress.neighborhood ? { delivery_neighborhood: parsedAddress.neighborhood } : {}),
                } : undefined,
            };
        }

        const minConf = Math.min(...items.map((i) => i.confidence));
        if (minConf < CONFIDENCE_LOW) {
            return {
                action: "low_confidence",
                message: `Não tenho certeza do produto. Confirma: ${items.map((i) => i.name).join(", ")}?`,
                confidence: minConf,
                contextUpdate: parsedAddress ? {
                    delivery_address: parsedAddress.formatted,
                    delivery_address_place_id: parsedAddress.placeId,
                    ...(parsedAddress.neighborhood ? { delivery_neighborhood: parsedAddress.neighborhood } : {}),
                } : undefined,
            };
        }

        // 4) Lógica de decisão
        const contextUpdate: Partial<Session["context"]> = {};

        if (parsedAddress) {
            contextUpdate.delivery_address = parsedAddress.formatted;
            if (parsedAddress.placeId) contextUpdate.delivery_address_place_id = parsedAddress.placeId;
            if (parsedAddress.neighborhood) contextUpdate.delivery_neighborhood = parsedAddress.neighborhood;
        }

        if (items.length > 0 && parsedAddress) {
            return {
                action: "confirm_order",
                items,
                address: parsedAddress,
                contextUpdate,
            };
        }

        if (items.length > 0 && !parsedAddress) {
            return {
                action: "add_to_cart",
                items,
                contextUpdate,
                askAddress: true,
            };
        }

        return { action: "product_not_found", message: "Produto não identificado." };
    }
}

// ─── Factory e exports ──────────────────────────────────────────────────────

let defaultInstance: OrderParserService | null = null;

export function getOrderParserService(googleApiKey?: string): OrderParserService {
    if (!defaultInstance) {
        defaultInstance = new OrderParserService({ googleApiKey });
    }
    return defaultInstance;
}

/** Converte ParsedItem[] em CartItem[] para merge no session.cart */
export function parsedItemsToCartItems(items: ParsedItem[]): CartItem[] {
    return items.map((i) => ({
        variantId: i.variantId,
        productId: i.productId,
        name:      i.name,
        price:     i.price,
        qty:       i.qty,
        isCase:    i.isCase,
    }));
}

export {
    extractQuantityFromText,
    extractAddressFromText as extractAddressRaw,
    splitMultiItems as splitOrderItems,
};
