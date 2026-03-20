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
    productId: string;
    variantId: string;
    name: string;
    price: number;
    qty: number;
    confidence: number;  // 1 - Fuse score (0–1)
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
    | { action: "low_confidence"; message: string; confidence: number }
    | { action: "product_not_found"; message: string }
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

/**
 * Extrai quantidade de um trecho de texto (número ou palavra).
 * Retorna { qty, remainder } onde remainder é o texto sem a quantidade.
 */
function extractQuantityFromText(text: string): { qty: number; remainder: string } {
    const t = text.trim();
    let qty = 1;
    let remainder = t;

    // Regex: número em qualquer posição (1-99), ex: "quero 2 skol" ou "2 skol"
    const numMatch = t.match(/(?:^|\s)(\d{1,2})\s+(.+)$/);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n >= 1 && n <= 99) {
            qty = n;
            remainder = numMatch[2].trim().replace(/\b(quero|quer|manda|traga|por favor|pf)\b/gi, "").trim();
            return { qty, remainder };
        }
    }

    // Regex: número no início
    const numStart = t.match(/^\s*(\d{1,2})\s+(.+)$/);
    if (numStart) {
        const n = parseInt(numStart[1], 10);
        if (n >= 1 && n <= 99) {
            qty = n;
            remainder = numStart[2].trim();
            return { qty, remainder };
        }
    }

    // Palavra por extenso no início
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
        const re = new RegExp(`^\\s*${word}\\s+(.+)$`, "i");
        const m = t.match(re);
        if (m) {
            qty = value;
            remainder = m[1].trim();
            return { qty, remainder };
        }
    }

    return { qty, remainder: t };
}

/**
 * Extrai endereço da mensagem usando regex e palavras-chave.
 * Procura por: rua/av/nº/bairro ou texto após "na"/"no".
 */
function extractAddressFromText(input: string): string | null {
    // Padrão principal: prefixo + nome + número
    const ADDR_RE = /\b(rua|r\.|av\.?|avenida|alameda|travessa|trav\.?|estrada|rodovia|pra[cç]a|p[cç][ao]\.?|beco|viela|setor|quadra|qd\.?)\s+([\wÀ-úÀ-ÿ\s]{2,50}?)[\s,]*(?:n[º°oa]?\.?\s*)?(\d{1,5})\b/i;
    const m = input.match(ADDR_RE);
    if (m) {
        const after = input.slice(input.indexOf(m[0]) + m[0].length).trim();
        const neighMatch = after.match(/^[\s,\-–]+([A-Za-zÀ-úÀ-ÿ][A-Za-zÀ-úÀ-ÿ\s]{1,40}?)(?:[,;.]|$)/i);
        const neighborhood = neighMatch ? ` - ${neighMatch[1].trim()}` : "";
        return `${m[0]}${neighborhood}`.trim();
    }

    // Fallback: texto após "na rua", "no bairro", "na av", etc.
    const afterPrep = input.match(/\b(?:na|no)\s+(rua|av\.?|avenida|bairro|r\.)\s+(.+?)(?:\.|$)/i);
    if (afterPrep) return afterPrep[2].trim();

    // Fallback: sequência que contém nº ou número de endereço
    const withNum = input.match(/.{10,80}(?:n[º°]\.?\s*|,\s*)\d{1,5}\b.{0,50}/i);
    if (withNum) return withNum[0].trim();

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
     * Extrai itens (produto + qty) de um trecho de texto.
     * @param includeLowConfidence Se true, inclui matches com confidence baixa (para detectar low_confidence).
     */
    private extractItems(text: string, includeLowConfidence = false): ParsedItem[] {
        const items: ParsedItem[] = [];
        const parts = splitMultiItems(text);

        for (const part of parts) {
            const { qty, remainder } = extractQuantityFromText(part);
            if (!remainder || remainder.length < 2) continue;

            const found = this.findProduct(remainder, includeLowConfidence);
            if (!found) continue;

            const p = found.product;
            const volLabel = p.volumeValue ? ` ${p.volumeValue}${p.unit ?? ""}` : "";
            const name = `${p.productName}${volLabel}`.trim();

            items.push({
                productId: p.productId,
                variantId: p.id,
                name,
                price: p.unitPrice,
                qty,
                confidence: found.confidence,
            });
        }

        return items;
    }

    /**
     * Remove o trecho de endereço do texto para não confundir a busca de produtos.
     */
    private removeAddressFromText(text: string, addressRaw: string): string {
        const candidates = ["na " + addressRaw, "no " + addressRaw, addressRaw];
        for (const toRemove of candidates) {
            const idx = text.toLowerCase().indexOf(toRemove.toLowerCase());
            if (idx >= 0) {
                const before = text.slice(0, idx).trim();
                const after = text.slice(idx + toRemove.length).trim();
                return [before, after].filter(Boolean).join(" ").trim();
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

        try {
            const res = await this.mapsClient.geocode({
                params: {
                    address: `${text.trim()}, Brazil`,
                    key: this.googleApiKey!,
                    components: "country:BR",
                },
            });

            const result = res.data.results?.[0];
            if (!result) return null;

            const formatted = result.formatted_address ?? text.trim();
            const comps = result.address_components ?? [];

            const getComp = (types: string[]) =>
                comps.find((c) => types.some((t) => c.types.includes(t)))?.long_name;

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

        // 1) Extrair endereço (se houver)
        let addressRaw = extractAddressFromText(raw);
        let parsedAddress: ParsedAddress | null = null;

        if (addressRaw) {
            if (options?.validateAddressWithGoogle && this.mapsClient) {
                parsedAddress = await this.validateAddress(addressRaw);
            } else {
                parsedAddress = { raw: addressRaw, formatted: addressRaw };
            }
        }

        // 2) Remover endereço do texto para buscar produtos
        const textForProducts = addressRaw ? this.removeAddressFromText(raw, addressRaw) : raw;
        if (!textForProducts.trim()) {
            if (parsedAddress) {
                return {
                    action: "add_to_cart",
                    items: [],
                    contextUpdate: {
                        delivery_address: parsedAddress.formatted,
                        delivery_address_place_id: parsedAddress.placeId,
                    },
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
                return { action: "low_confidence", message: `Não tenho certeza do produto _"${textForProducts}"_.`, confidence: best.confidence };
            }
            return { action: "product_not_found", message: `Não consegui identificar o produto em _"${textForProducts}"_.` };
        }

        const minConf = Math.min(...items.map((i) => i.confidence));
        if (minConf < CONFIDENCE_LOW) {
            return { action: "low_confidence", message: `Não tenho certeza do produto. Confirma: ${items.map((i) => i.name).join(", ")}?`, confidence: minConf };
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
        name: i.name,
        price: i.price,
        qty: i.qty,
    }));
}

export {
    extractQuantityFromText,
    extractAddressFromText as extractAddressRaw,
    splitMultiItems as splitOrderItems,
};
