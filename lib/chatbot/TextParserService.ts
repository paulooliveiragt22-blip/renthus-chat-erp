/**
 * TextParserService
 *
 * Extrai produtos e endereços de frases como "quero 2 cocas na rua turmalina 120".
 * Usa regex para endereço e quantidade, Fuse.js para match de produtos.
 * Inclui cache de produtos e validação de endereço via Google Geocoding.
 */

import Fuse from "fuse.js";
import { Client } from "@googlemaps/google-maps-services-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProductDisplayName } from "./displayHelpers";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ProductForSearch {
    id: string;
    productId: string;
    productName: string;
    unitPrice: number;
    tags?: string | null;
    details?: string | null;
    /** produto_embalagens.descricao — somente para busca, nunca exibir ao cliente */
    searchDesc?: string | null;
    bulkSigla?: string | null;
    caseQty?: number | null;
    hasCase?: boolean;
    casePrice?: number | null;
    caseVariantId?: string;
}

export interface ParsedProduct {
    id: string;   // variantId para OrderParserService/CartItem
    qty: number;
}

export interface TextParseResult {
    products: ParsedProduct[];
    rawAddress: string | null;
}

export interface StructuredAddress {
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    placeId: string;
    formatted?: string;
}

// ─── Cache de produtos (10 min) ───────────────────────────────────────────────

interface CacheEntry {
    data: ProductForSearch[];
    expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const productsCache = new Map<string, CacheEntry>();

/**
 * Busca produtos da view_chat_produtos no Supabase com cache de 10 minutos.
 * Formato compatível com Fuse.js e OrderParserService.
 */
export async function getCachedProducts(
    admin: SupabaseClient,
    companyId: string
): Promise<ProductForSearch[]> {
    const cached = productsCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const { data: rows, error } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, preco_venda, tags, tags_auto, product_name, product_details, volume_quantidade, product_unit_type, unit_type_sigla, sigla_comercial, fator_conversao, product_volume_id")
        .eq("company_id", companyId)
        .limit(800);

    if (error) {
        console.error("[TextParserService] getCachedProducts error:", error.message);
        return [];
    }

    // Group by (produto_id, product_volume_id) — each distinct volume is a separate variant
    const BULK_SIGLAS = new Set(["CX", "FARD", "PAC"]);
    const byVol: Record<string, { unitPack: any; casePack: any; caseSigla: string | null; prodId: string }> = {};
    for (const r of (rows ?? []) as any[]) {
        const key = `${r.produto_id}::${r.product_volume_id ?? "null"}`;
        byVol[key] ??= { unitPack: null, casePack: null, caseSigla: null, prodId: String(r.produto_id) };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" && !byVol[key].unitPack) byVol[key].unitPack = r;
        if (BULK_SIGLAS.has(sig) && !byVol[key].casePack) {
            byVol[key].casePack  = r;
            byVol[key].caseSigla = sig;
        }
    }

    const products: ProductForSearch[] = Object.entries(byVol)
        .map(([, grp]) => {
            const unitPack = grp.unitPack ?? grp.casePack;
            if (!unitPack) return null;
            const casePack  = grp.casePack;
            const bulkSigla = grp.caseSigla;
            const caseQty   = casePack ? Number(casePack.fator_conversao ?? 1) : null;
            const details    = (unitPack.descricao ?? unitPack.product_details ?? null) as string | null;
            const searchDesc = (unitPack.descricao ?? null) as string | null;
            const name = buildProductDisplayName({
                productName:   String(unitPack.product_name ?? ""),
                volumeValue:   Number(unitPack.volume_quantidade ?? 0),
                unit:          String(unitPack.product_unit_type ?? ""),
                unitTypeSigla: (unitPack.unit_type_sigla ?? null) as string | null,
                details,
                caseQty:   null,
                bulkSigla: null,
            });
            return {
                id:            String(unitPack.id),
                productId:     grp.prodId,
                productName:   name || String(unitPack.product_name ?? ""),
                unitPrice:     Number(unitPack.preco_venda ?? 0),
                tags:          (unitPack.tags_auto ?? unitPack.tags) || null,
                details,
                searchDesc,
                bulkSigla,
                caseQty,
                hasCase:       Boolean(casePack),
                casePrice:     casePack ? Number(casePack.preco_venda ?? 0) : null,
                caseVariantId: casePack ? String(casePack.id) : undefined,
            } as ProductForSearch;
        })
        .filter(Boolean) as ProductForSearch[];

    productsCache.set(companyId, {
        data: products,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return products;
}

/** Invalida o cache de produtos (útil após atualização de cadastro) */
export function invalidateProductsCache(companyId?: string): void {
    if (companyId) productsCache.delete(companyId);
    else productsCache.clear();
}

// ─── Constantes Regex ─────────────────────────────────────────────────────────

const QUANTITY_WORDS: Record<string, number> = {
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "três": 3, "quatro": 4,
    "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10,
    "onze": 11, "doze": 12, "vinte": 20, "trinta": 30,
};

/** Indicadores de endereço + preposições */
const ADDRESS_INDICATORS = "(?:rua|r\\.|av\\.?|avenida|pra[cç]a|travessa|trav\\.?|alameda|rodovia|estrada|beco|viela|setor|quadra|qd\\.?|bairro)";
const PREPOSITIONS = "(?:na|no|em)\\s+";

/** Regex: (Rua|Av|...) Nome Nº número ou na/no Nome */
const ADDRESS_REGEX = new RegExp(
    `\\b(?:${ADDRESS_INDICATORS}\\s+[\\wÀ-úÀ-ÿ\\s]{2,60}?[\\s,]*(?:n[º°oa]?\\.?\\s*)?\\d{1,5}|` +
    `${PREPOSITIONS}(?:${ADDRESS_INDICATORS}\\s+)?[\\wÀ-úÀ-ÿ\\s,\\d]{5,100}?)`,
    "gi"
);

const FUSE_THRESHOLD = 0.45;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function extractQuantityFromText(text: string): { qty: number; remainder: string } {
    const t = text.trim();
    let qty = 1;
    let remainder = t;

    const numMatch = t.match(/(?:^|\s)(\d{1,2})\s+(.+)$/);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n >= 1 && n <= 99) {
            qty = n;
            remainder = numMatch[2].trim().replace(/\b(quero|quer|manda|traga|por favor|pf)\b/gi, "").trim();
            return { qty, remainder };
        }
    }

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

function splitItems(input: string): string[] {
    return input
        .split(/\s+e\s+|\s*\+\s*|\s*,\s*|\s+mais\s+|\s+com\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
}

// ─── TextParserService ────────────────────────────────────────────────────────

/**
 * Extrai produtos e endereço de uma frase.
 * Retorna { products: [{ id, qty }], rawAddress: string | null }
 */
export function parseText(text: string, productsList: ProductForSearch[]): TextParseResult {
    const raw = text.trim();
    if (!raw || raw.length < 2) {
        return { products: [], rawAddress: null };
    }

    // 1) Extrair endereço com regex
    let rawAddress: string | null = null;
    let textWithoutAddress = raw;

    const addrMatches = raw.matchAll(ADDRESS_REGEX);
    for (const m of addrMatches) {
        const match = m[0].trim();
        if (match.length >= 8) {
            rawAddress = match.replace(/^(?:na|no|em)\s+/i, "").trim();
            const idx = textWithoutAddress.toLowerCase().indexOf(match.toLowerCase());
            if (idx >= 0) {
                const before = textWithoutAddress.slice(0, idx).trim();
                const after = textWithoutAddress.slice(idx + match.length).trim();
                textWithoutAddress = [before, after].filter(Boolean).join(" ").trim();
            }
            break;
        }
    }

    // Fallback: padrão rua/av + nome + número
    const addrMain = raw.match(/\b(rua|r\.|av\.?|avenida|travessa|alameda|rodovia|pra[cç]a)\s+[\wÀ-úÀ-ÿ\s]{2,50}?[\s,]*(?:n[º°]?\.?\s*)?\d{1,5}\b/i);
    if (addrMain && !rawAddress) {
        rawAddress = addrMain[0].trim();
        textWithoutAddress = raw.replace(addrMain[0], " ").replace(/\s+/g, " ").trim();
    }

    // 2) Remover verbos de pedido
    const cleanForProducts = textWithoutAddress
        .replace(/\b(quero|quer|manda|traga|por favor|pf|pra|para)\b/gi, "")
        .trim();

    if (!cleanForProducts) {
        return { products: productsList.length ? [] : [], rawAddress };
    }

    // 3) Fuse.js para match de produtos
    const fuse = new Fuse(productsList, {
        keys: [
            { name: "productName", weight: 0.55 },
            { name: "tags", weight: 0.25 },
            { name: "searchDesc", weight: 0.12 },
            { name: "details", weight: 0.08 },
        ],
        threshold: FUSE_THRESHOLD,
        includeScore: true,
        ignoreLocation: true,
    });

    const products: ParsedProduct[] = [];
    const parts = splitItems(cleanForProducts);

    for (const part of parts) {
        const { qty, remainder } = extractQuantityFromText(part);
        if (!remainder || remainder.length < 2) continue;

        const results = fuse.search(remainder, { limit: 1 });
        if (!results.length) continue;

        const [best] = results;
        const score = best.score ?? 1;
        if (score > FUSE_THRESHOLD) continue;

        products.push({ id: best.item.id, qty });
    }

    return { products, rawAddress };
}

// ─── validateAddressViaGoogle (validação pura, sem tocar na sessão) ───────────

/**
 * Valida rawAddress via Google Geocoding API.
 * Usa GOOGLE_MAPS_API_KEY do ambiente.
 *
 * @returns { ok, structured, needsNumber } — needsNumber quando falta número ou endereço ambíguo
 */
export async function validateAddressViaGoogle(
    rawAddress: string
): Promise<{ ok: boolean; structured?: StructuredAddress; needsNumber?: boolean; error?: string }> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        return { ok: false, error: "GOOGLE_MAPS_API_KEY não configurada" };
    }
    if (!rawAddress?.trim()) {
        return { ok: false, error: "Endereço vazio" };
    }

    const client = new Client({});
    try {
        const res = await client.geocode({
            params: {
                address: `${rawAddress.trim()}, Brazil`,
                key: apiKey,
                components: "country:BR",
                language: "pt-BR",
            },
        });

        if (res.data.status !== "OK" && res.data.status !== "ZERO_RESULTS") {
            console.error("[TextParserService] Geocoding API:", res.data.status, res.data.error_message);
            return { ok: false, error: "Erro ao validar endereço" };
        }

        const results = res.data.results ?? [];
        if (!results.length) {
            return { ok: false, needsNumber: true, error: "Endereço não encontrado" };
        }

        const result = results[0];
        const comps = result.address_components ?? [];
        const formatted = result.formatted_address ?? rawAddress;

        const getComp = (types: string[]) =>
            comps.find((c) => types.some((t) => (c.types as readonly string[]).includes(t)))?.long_name ?? "";
        const getShort = (types: string[]) =>
            comps.find((c) => types.some((t) => (c.types as readonly string[]).includes(t)))?.short_name ?? "";

        const rua = getComp(["route"]);
        const numero = getComp(["street_number"]);
        const bairro = getComp(["sublocality", "sublocality_level_1", "neighborhood"]);
        const cidade = getComp(["administrative_area_level_2", "locality"]);
        const estado = getShort(["administrative_area_level_1"]);
        const cep = getComp(["postal_code"]);
        const placeId = result.place_id ?? "";

        const structured: StructuredAddress = {
            rua: rua || rawAddress.split(/\d/)[0]?.trim() || "",
            numero,
            bairro,
            cidade,
            estado,
            cep,
            placeId,
            formatted,
        };

        const hasNumber = !!numero || /\d{1,5}\b/.test(rawAddress);
        const isPrecise = hasNumber && (rua || bairro);

        if (isPrecise) {
            return { ok: true, structured };
        }
        return { ok: false, needsNumber: true, structured };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[TextParserService] validateAddressViaGoogle:", msg);
        return { ok: false, error: msg };
    }
}

// ─── processAddressValidation (atualiza sessão) ───────────────────────────────

/**
 * Valida endereço via Google Geocoding e atualiza chatbot_sessions.
 *
 * - Se endereço preciso (com número e bairro): step = 'checkout_confirm', salva endereço estruturado no context.
 * - Se ambíguo ou sem número: step = 'awaiting_address_number', salva parcial no context.
 */
export async function processAddressValidation(
    rawAddress: string,
    sessionId: string,
    admin: SupabaseClient
): Promise<{ ok: boolean; structured?: StructuredAddress; needsNumber?: boolean; error?: string }> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.warn("[TextParserService] GOOGLE_MAPS_API_KEY não configurado");
        return { ok: false, error: "API de endereço não configurada" };
    }

    if (!rawAddress?.trim()) {
        return { ok: false, error: "Endereço vazio" };
    }

    // 1) Buscar sessão atual
    const { data: session, error: fetchErr } = await admin
        .from("chatbot_sessions")
        .select("id, thread_id, company_id, context, step")
        .eq("id", sessionId)
        .single();

    if (fetchErr || !session) {
        console.error("[TextParserService] Sessão não encontrada:", sessionId, fetchErr);
        return { ok: false, error: "Sessão não encontrada" };
    }

    const context = (session.context as Record<string, unknown>) ?? {};
    const client = new Client({});

    try {
        const res = await client.geocode({
            params: {
                address: `${rawAddress.trim()}, Brazil`,
                key: apiKey,
                components: "country:BR",
                language: "pt-BR",
            },
        });

        if (res.data.status !== "OK" && res.data.status !== "ZERO_RESULTS") {
            console.error("[TextParserService] Geocoding API error:", res.data.status, res.data.error_message);
            return { ok: false, error: "Erro ao validar endereço" };
        }

        const results = res.data.results ?? [];
        if (!results.length) {
            await admin.from("chatbot_sessions").update({
                step: "awaiting_address_number",
                context: {
                    ...context,
                    address_draft: rawAddress.trim(),
                    address_validation_error: "Endereço não encontrado",
                },
                updated_at: new Date().toISOString(),
            }).eq("id", sessionId);
            return { ok: false, needsNumber: true, error: "Endereço não encontrado" };
        }

        const result = results[0];
        const comps = result.address_components ?? [];
        const formatted = result.formatted_address ?? rawAddress;

        const getComp = (types: string[]) =>
            comps.find((c) => types.some((t) => (c.types as readonly string[]).includes(t)))?.long_name ?? "";
        const getShort = (types: string[]) =>
            comps.find((c) => types.some((t) => (c.types as readonly string[]).includes(t)))?.short_name ?? "";

        const rua = getComp(["route"]);
        const numero = getComp(["street_number"]);
        const bairro = getComp(["sublocality", "sublocality_level_1", "neighborhood"]);
        const cidade = getComp(["administrative_area_level_2", "locality"]);
        const estado = getShort(["administrative_area_level_1"]);
        const cep = getComp(["postal_code"]);
        const placeId = result.place_id ?? "";

        const structured: StructuredAddress = {
            rua: rua || rawAddress.split(/\d/)[0]?.trim() || "",
            numero,
            bairro,
            cidade,
            estado,
            cep,
            placeId,
            formatted,
        };

        const hasNumber = !!numero || /\d{1,5}\b/.test(rawAddress);
        const isPrecise = hasNumber && (rua || bairro);

        if (isPrecise) {
            await admin.from("chatbot_sessions").update({
                step: "checkout_confirm",
                context: {
                    ...context,
                    delivery_address: formatted,
                    delivery_address_structured: structured,
                    delivery_address_place_id: placeId,
                    address_draft: undefined,
                    address_validation_error: undefined,
                },
                updated_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            }).eq("id", sessionId);
            return { ok: true, structured };
        }

        await admin.from("chatbot_sessions").update({
            step: "awaiting_address_number",
            context: {
                ...context,
                address_draft: rawAddress.trim(),
                delivery_address_structured: structured,
                delivery_address_place_id: placeId,
                address_validation_error: "Informe o número do endereço",
            },
            updated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }).eq("id", sessionId);
        return { ok: false, needsNumber: true, structured };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[TextParserService] processAddressValidation error:", msg);
        await admin.from("chatbot_sessions").update({
            step: "awaiting_address_number",
            context: {
                ...context,
                address_draft: rawAddress.trim(),
                address_validation_error: "Não foi possível validar o endereço. Tente novamente.",
            },
            updated_at: new Date().toISOString(),
        }).eq("id", sessionId);
        return { ok: false, error: msg };
    }
}
