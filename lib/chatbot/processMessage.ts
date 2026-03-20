/**
 * lib/chatbot/processMessage.ts
 *
 * Motor completo do chatbot de disk bebidas via WhatsApp + Meta Cloud API.
 *
 * Fluxo:
 *   welcome → main_menu → catalog_categories → catalog_brands → catalog_products
 *   → cart → checkout_address → checkout_payment → checkout_confirm → done
 *                                                                     ↘ handover
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage, sendListMessageSections } from "../whatsapp/send";
import { getCachedProducts } from "./TextParserService";
import { getOrderParserService, parsedItemsToCartItems } from "./OrderParserService";
import { extractPackagingIntent, packagingLabel, isBulkPackaging } from "./PackagingExtractor";
import { parseWithFactory } from "./parsers/ParserFactory";
import { buildProductDisplayName as _buildProductDisplayName } from "./displayHelpers";
export type { DisplayableVariant } from "./displayHelpers";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProcessMessageParams {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    messageId: string;
    phoneE164: string;
    text: string;
    profileName?: string | null;
}

interface CartItem {
    variantId: string;
    productId: string;
    name: string;     // ex: "Heineken 600ml" ou "Heineken 600ml (cx 12un)"
    price: number;
    qty: number;
    isCase?: boolean; // true = compra por caixa
    caseQty?: number; // unidades por caixa (para cálculo de unid. totais)
}

interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, unknown>;
}

// ─── Helpers de texto ─────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function matchesAny(input: string, keywords: string[]): boolean {
    const n = normalize(input);
    return keywords.some((k) => n.includes(normalize(k)));
}

/**
 * Detecta forma de pagamento em texto livre (case insensitive).
 * Trata variações como "pix", "no pix", "vai ser no cartão", "1" (cartão), "2" (pix), "3" (dinheiro).
 * Retorna "pix" | "card" | "cash" ou null.
 */
function detectPaymentMethod(input: string): "pix" | "card" | "cash" | null {
    const n = normalize(input).trim();
    if (!n) return null;

    // Only detect numbers as payment IF they're alone (not mixed with product text)
    // i.e., the ENTIRE message is just "1", "2", or "3"
    if (/^\s*1\s*$/.test(input)) return "card";
    if (/^\s*2\s*$/.test(input)) return "pix";
    if (/^\s*3\s*$/.test(input)) return "cash";

    if (/\bpix\b/i.test(input)) return "pix";
    if (/\b(cartao|cartão|card|credito|crédito|debito|débito|maquina|maquininha)\b/i.test(input)) return "card";
    if (/\b(dinheiro|cash|especie|espécie)\b/i.test(input)) return "cash";

    return null;
}

// ─── Processamento de linguagem natural ───────────────────────────────────────

/** Palavras que não carregam informação de produto e devem ser ignoradas na busca. */
const STOPWORDS = new Set([
    // intenção / verbos
    "quero","quer","queria","gostaria","pode","manda","mande","traz","traga",
    "ve","ver","preciso","quero pedir","to querendo","vou querer","quero ver",
    "comprar","pedir","adicionar","colocar","botar","busca","buscar",
    "acrescentar","botar","quero adicionar","quero botar","coloca","coloque",
    "poe","traz mais","manda mais","inclui","incluir","aumentar",
    // pronomes / artigos / preposições
    "me","mim","pra","para","de","do","da","dos","das","um","uma","uns","umas",
    "o","a","os","as","eh","e","com","sem","por","no","na","nos","nas","ai","aqui",
    "la","la","aquele","aquela","voce","vc","tu","voce","isso","esse","essa",
    "esses","essas","desse","desta","dele","dela","este","esta","aqui","so","la",
    // filler / cortesia
    "mano","cara","brother","bro","pfv","pf","por favor","favor","obrigado","obg",
    "bom","boa","dia","tarde","noite","oi","ola","alo","tudo","bem","ate",
    "também","mais","só","somente","apenas","mesmo","mesma","tal",
    // genéricos de produto
    "produto","bebida","bebidas","item","itens","coisas","coisa","alguma",
    "alguem","algo","tem","ter","disponivel","disponivel","disponivel",
    // preposições comuns que costumam sobrar no fim após remover endereço
    "em",
]);

// Termos normalizados que podem virar quantidade (normalize() remove acentos).
const QUANTITY_WORDS_NORM: Record<string, number> = {
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
};

/**
 * Remove stopwords e retorna os termos relevantes.
 * Ex: "quero 3 skol lata por favor" → ["3","skol","lata"]
 * Ex: "Quero 3 cerveja Skol" → ["3","cerveja","skol"]
 */
function extractTerms(input: string): string[] {
    const words = normalize(input).split(/[\s,;:!?]+/);
    return words.filter((w) => {
        if (!w) return false;
        const isQtyToken = /^\d+$/.test(w) || Object.prototype.hasOwnProperty.call(QUANTITY_WORDS_NORM, w);
        if (!isQtyToken && w.length < 2) return false;
        // Quantidades (ex: "um", "tres") devem passar mesmo estando em STOPWORDS.
        if (STOPWORDS.has(w) && !isQtyToken) return false;
        return true;
    });
}

/**
 * Extrai quantidade numérica de uma lista de termos.
 * Returns { qty, terms } where terms has the number removed.
 */
function extractQuantity(terms: string[]): { qty: number; terms: string[] } {
    let qty = 1;
    const rest: string[] = [];
    for (const t of terms) {
        const wordQty = QUANTITY_WORDS_NORM[t];
        if (typeof wordQty === "number") {
            qty = wordQty;
            continue;
        }

        const n = parseInt(t, 10);
        if (!isNaN(n) && n >= 1 && n <= 99 && /^\d+$/.test(t)) {
            qty = n;
            continue;
        }

        rest.push(t);
    }
    return { qty, terms: rest };
}

/**
 * Divide a mensagem em partes por separadores comuns de pedido múltiplo.
 * Ex: "2 skol e 1 gelo" → ["2 skol", "1 gelo"]
 * Ex: "brahma, skol + carvao" → ["brahma", "skol", "carvao"]
 */
function splitMultiItems(input: string): string[] {
    return input
        .split(/\s+e\s+|\s*\+\s*|\s*,\s*|\s+mais\s+|\s+com\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/** Palavras que indicam bebida → ativam sugestão de gelo/carvão. */
const DRINK_KEYWORDS = [
    "cerveja","chopp","vodka","rum","gin","whisky","whiskey","cachaca",
    "destilado","dose","longeck","lata","latinha","litrao","garrafa",
    "refrigerante","energetico","gelada","gelado","skol","brahma",
    "heineken","corona","budweiser","original","itaipava","amstel",
];

/** Retorna true se o nome do item parece uma bebida. */
function isDrinkItem(name: string): boolean {
    const n = normalize(name);
    return DRINK_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Verifica se o carrinho tem pelo menos uma bebida MAS não tem gelo ou carvão.
 * Usado para disparar o cross-selling.
 */
function needsCrossSell(cart: CartItem[]): boolean {
    const hasDrink    = cart.some((i) => isDrinkItem(i.name));
    const hasIceCoal  = cart.some((i) => {
        const n = normalize(i.name);
        return n.includes("gelo") || n.includes("carvao") || n.includes("carvão");
    });
    return hasDrink && !hasIceCoal;
}

/** Mescla um array de novos itens no carrinho existente (soma qtd se já existe). */
function mergeCart(existing: CartItem[], toAdd: CartItem[]): CartItem[] {
    const cart = [...existing];
    for (const item of toAdd) {
        const idx = cart.findIndex((c) => c.variantId === item.variantId && Boolean(c.isCase) === Boolean(item.isCase));
        if (idx >= 0) cart[idx] = { ...cart[idx], qty: cart[idx].qty + item.qty };
        else cart.push(item);
    }
    return cart;
}

/**
 * Formata uma lista numerada de variantes para texto simples do WhatsApp.
 * Ex:
 *   1️⃣ Skol 350ml — R$ 4,50
 *   2️⃣ Skol 600ml — R$ 8,00
 */
const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

function formatNumberedList(variants: VariantRow[]): string {
    return variants.map((v, i) => {
        const name  = buildProductDisplayName(v);
        const emoji = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
        return `${emoji} *${name}* — ${formatCurrency(v.unitPrice)}`;
    }).join("\n");
}

interface AddressMatch {
    street:      string;   // "Rua das Flores"
    houseNumber: string;   // "86"
    neighborhood: string | null; // "São Mateus" (se detectado)
    full: string;          // formatted: "Rua das Flores, 86 - São Mateus"
    rawSlice: string;      // trecho original que foi reconhecido como endereço
}

/**
 * Extrai endereço de entrega de mensagem livre usando regex.
 *
 * Captura:
 *   (rua|av|avenida|...) <nome da rua> [,] (nº|n|nro)? <número>
 *
 * Depois tenta capturar o bairro como bloco de palavras após o número.
 */
function extractAddressFromText(input: string): AddressMatch | null {
    // Padrão principal — captura prefixo + nome + número
    const ADDR_RE = /\b(rua|r\.|av\.?|avenida|alameda|travessa|trav\.?|estrada|rodovia|pra[cç]a|p[cç][ao]\.?|beco|viela|setor|quadra|qd\.?)\s+([\wÀ-úÀ-ÿ\s]{2,50}?)[\s,]*(?:n[º°oa]?\.?\s*)?(\d{1,5})\b/i;

    const m = input.match(ADDR_RE);
    if (!m) return null;

    const prefix      = m[1].trim();
    const streetName  = m[2].trim().replace(/,+$/, "").trim();
    const houseNumber = m[3];
    const rawSlice    = m[0];

    // Tenta capturar bairro: texto após o número e possível vírgula/hífen/espaço
    const afterAddr = input.slice(input.indexOf(rawSlice) + rawSlice.length).trim();
    // Bairro = 1ª sequência de palavras (até vírgula, ponto, ou fim)
    const neighMatch = afterAddr.match(/^[\s,\-–]+([A-Za-zÀ-úÀ-ÿ][A-Za-zÀ-úÀ-ÿ\s]{1,40}?)(?:[,;.]|$)/i);
    const neighborhood = neighMatch ? neighMatch[1].trim() : null;

    const street = `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()} ${streetName}`;
    const full   = neighborhood
        ? `${street}, ${houseNumber} - ${neighborhood}`
        : `${street}, ${houseNumber}`;

    return { street, houseNumber, neighborhood, full, rawSlice };
}

/** Detecta endereço parcial (ex: "na rua X" sem número) para interceptor global */
function detectAddressAnywhere(input: string): AddressMatch | { full: string; rawSlice: string } | null {
    const m = extractAddressFromText(input);
    if (m) return m;
    const fallback = input.match(/\b(?:na|no)\s+(?:rua|r\.|av\.?|avenida)\s+([\wÀ-úÀ-ÿ\s,]{5,80}?)(?:\s*$|[.,]|$)/i);
    if (fallback) {
        const raw = fallback[0].trim();
        return { full: raw.replace(/^(?:na|no)\s+/i, "").trim(), rawSlice: raw };
    }
    return null;
}

const AFFIRMATIVE = ["sim","s","yes","continuar","continue","blz","ok","pode","beleza","top","certo","perfeito","exato","claro","positivo","vai","bora","tudo bem","tudo certo","isso","com certeza","manda","pode sim","por favor","pfv"];
const NEGATIVE = ["nao","n","no","nope","negativo","desistir","voltar","nao quero","nao obrigado"];

function extractClientName(input: string): string | null {
    const m = input.match(/(?:sou o?a?\s+|me chamo\s+|meu nome [eé]\s+|chamo\s+|pode me chamar de\s+)([A-Za-zÀ-ú][a-zà-ú]*(?:\s+[A-Za-zÀ-ú][a-zà-ú]*)*)/i);
    if (!m) return null;
    const name = m[1].trim();
    // Capitalize first letter of each word
    return name.replace(/\b([a-zà-ú])/g, (c) => c.toUpperCase());
}

function hasVolumeClue(text: string): boolean {
    return /\b(ml|litro|litros|kg|cx|caixa|fardo|pac|lata)\b/i.test(text) || /\d+\s*(ml|l|kg|litro)/i.test(text);
}

function detectRemoveIntent(input: string): boolean {
    return /\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/i.test(input);
}

function detectMultipleAddresses(input: string): string[] | null {
    const ADDR_RE = /\b(?:rua|r\.|av\.?|avenida|alameda|travessa|estrada|rodovia|pra[cç]a|setor|quadra)\s+[\wÀ-úÀ-ÿ\s]{2,50}?\s+\d{1,5}\b/gi;
    const matches = input.match(ADDR_RE);
    if (matches && matches.length >= 2) return matches;
    return null;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

function cartTotal(cart: CartItem[]): number {
    return cart.reduce((acc, i) => acc + i.price * i.qty, 0);
}

function formatCart(cart: CartItem[]): string {
    if (!cart.length) return "Seu carrinho está vazio.";
    const lines = cart.map(
        (i, idx) => `${idx + 1}. ${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`
    );
    lines.push(`\n*Total: ${formatCurrency(cartTotal(cart))}*`);
    return lines.join("\n");
}

// ─── DB: Sessão ───────────────────────────────────────────────────────────────

async function getOrCreateSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string
): Promise<Session> {
    const { data } = await admin
        .from("chatbot_sessions")
        .select("id, step, cart, customer_id, context")
        .eq("thread_id", threadId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (data) {
        return {
            id:          data.id,
            step:        data.step ?? "welcome",
            cart:        (data.cart as CartItem[]) ?? [],
            customer_id: data.customer_id ?? null,
            context:     (data.context as Record<string, unknown>) ?? {},
        };
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const { data: created } = await admin
        .from("chatbot_sessions")
        .upsert(
            {
                thread_id:  threadId,
                company_id: companyId,
                step:       "welcome",
                cart:       [],
                context:    {},
                expires_at: expiresAt,
            },
            { onConflict: "thread_id" }
        )
        .select("id, step, cart, customer_id, context")
        .single();

    return {
        id:          created?.id ?? "",
        step:        created?.step ?? "welcome",
        cart:        [],
        customer_id: null,
        context:     {},
    };
}

async function saveSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    patch: Partial<Omit<Session, "id">>
): Promise<void> {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await admin.from("chatbot_sessions").upsert(
        {
            thread_id:   threadId,
            company_id:  companyId,
            expires_at:  expiresAt,
            updated_at:  new Date().toISOString(),
            ...(patch.step        !== undefined && { step:        patch.step }),
            ...(patch.cart        !== undefined && { cart:        patch.cart }),
            ...(patch.customer_id !== undefined && { customer_id: patch.customer_id }),
            ...(patch.context     !== undefined && { context:     patch.context }),
        },
        { onConflict: "thread_id" }
    );
}

// ─── DB: Empresa ──────────────────────────────────────────────────────────────

async function getCompanyInfo(
    admin: SupabaseClient,
    companyId: string
): Promise<{ name: string; settings: Record<string, unknown> } | null> {
    const { data } = await admin
        .from("companies")
        .select("name, settings")
        .eq("id", companyId)
        .maybeSingle();

    return data
        ? { name: data.name ?? "nossa loja", settings: (data.settings as Record<string, unknown>) ?? {} }
        : null;
}

// ─── DB: Cardápio ─────────────────────────────────────────────────────────────

interface Category {
    id: string;
    name: string;
}

interface Brand {
    id: string;
    name: string;
}

/** Variante de produto para exibição no catálogo (após seleção de marca). */
interface VariantRow {
    id:              string;
    productId:       string;
    productName:     string;
    details:         string | null;
    tags:            string | null;  // sinônimos separados por vírgula
    volumeValue:     number;
    unit:            string;
    /** Sigla da unidade de medida do volume (ex: "ml", "L", "kg"). Vem do JOIN com unit_types. */
    unitTypeSigla:   string | null;
    unitPrice:       number;
    hasCase:         boolean;
    caseQty:         number | null;
    casePrice:       number | null;
    /** Sigla comercial da embalagem bulk: "CX" | "FARD" | "PAC" (null quando só tem UN) */
    bulkSigla:       string | null;
    // ID da embalagem bulk (CX/FARD/PAC) para debitar estoque quando `isCase === true`.
    caseVariantId?:  string;
    isAccompaniment: boolean;
}

// ─── helpers de texto (normalização para busca) ───────────────────────────────

/**
 * Verifica se um termo de busca bate com o produto.
 * Retorna 2 = match no nome/marca (prioridade alta), 1 = match nas tags/detalhes, 0 = sem match.
 */
function matchScore(term: string, productName: string, tags: string | null): 0 | 1 | 2 {
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

// ─── Apresentação de produtos ─────────────────────────────────────────────────

/**
 * Monta o nome de exibição do produto de forma robusta, em 4 níveis de fallback.
 *
 * Prioridade de volume:
 *   1. volumeValue + unitTypeSigla → "Heineken 600ml"     (estruturado completo)
 *   2. volumeValue + unit          → "Heineken 600ml"     (fallback campo produto)
 *   3. descricao que parece volume → "Skol 600ml"         (parse do campo livre)
 *   4. descricao significativa     → "Skol Latinha"       (ex: "latinha","trezentinha")
 *   5. só o nome do produto        → "Skol"
 *
 * Sufixo de embalagem (quando isCase=true):
 *   CX   → " (cx 24un)"
 *   FARD → " (fardo 24un)"
 *   PAC  → " (pct 15un)"
 */
const buildProductDisplayName = _buildProductDisplayName;

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
function filterVariantsByPackaging(
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

async function getCategories(admin: SupabaseClient, companyId: string): Promise<Category[]> {
    const { data } = await admin
        .from("view_categories")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");

    return (data as Category[]) ?? [];
}

/**
 * Um item na lista de produtos (etapa 1 da seleção).
 * Um entry por produto+variante; unitário vs caixa é escolhido na etapa seguinte.
 */
interface ProductListItem {
    idx:         number;
    productId:   string;
    variantId:   string;
    displayName: string;  // marca + volume sem prefixo da categoria, ex: "Original 300ml"
    unitPrice:   number;
    hasCase:     boolean;
    caseQty?:    number;
    casePrice?:  number;
}

/** Remove o prefixo da categoria do nome do produto (case-insensitive). */
function stripCategoryPrefix(productName: string, categoryName: string): string {
    const lower = normalize(productName);
    const cat   = normalize(categoryName);
    if (lower.startsWith(cat + " ")) return productName.slice(categoryName.length).trim();
    return productName;
}

async function getProductsByCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryId: string,
    categoryName: string
): Promise<ProductListItem[]> {
    const { data: rows } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, product_name, sigla_comercial")
        .eq("company_id", companyId)
        .eq("category_id", categoryId)
        .limit(500);

    if (!rows?.length) return [];

    const BULK_SIGLAS = new Set(["CX", "CAIXA", "FARD", "PAC"]);
    const byProd: Record<string, { unit: any | null; case: any | null }> = {};
    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        byProd[pid] ??= { unit: null, case: null };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" || sig === "UNIDADE") byProd[pid].unit = r;
        if (BULK_SIGLAS.has(sig) && !byProd[pid].case) byProd[pid].case = r; // primeiro bulk encontrado
    }

    const options: ProductListItem[] = [];
    let idx = 1;
    const seen = new Set<string>();

    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        if (seen.has(pid)) continue;
        const unitPack = byProd[pid]?.unit;
        if (!unitPack) continue;
        seen.add(pid);

        const shortName = stripCategoryPrefix(r.product_name, categoryName);
        const vol = unitPack.descricao ? String(unitPack.descricao) : null;
        const displayName = vol ? `${shortName} ${vol}` : shortName;
        const casePack = byProd[pid]?.case ?? null;

        options.push({
            idx:         idx++,
            productId:   pid,
            variantId:   String(unitPack.id),
            displayName,
            unitPrice:   Number(unitPack.preco_venda ?? 0),
            hasCase:     Boolean(casePack),
            caseQty:     casePack?.fator_conversao ? Number(casePack.fator_conversao) : undefined,
            casePrice:   casePack?.preco_venda ? Number(casePack.preco_venda) : undefined,
        });

        if (idx > 10) break;
    }

    return options;
}

/** @deprecated Marca removida — retorna [] */
async function getBrandsByCategory(): Promise<Brand[]> {
    return [];
}

async function getVariantsByBrandAndCategory(
    admin: SupabaseClient,
    companyId: string,
    _brandId: string,
    categoryId: string
): Promise<VariantRow[]> {
    return getVariantsByCategory(admin, companyId, categoryId);
}

async function getVariantsByCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryId: string
): Promise<VariantRow[]> {
    const { data: rows } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, is_acompanhamento, sigla_comercial, product_name, product_unit_type, product_details")
        .eq("company_id", companyId)
        .eq("category_id", categoryId)
        .limit(500);

    if (!rows?.length) return [];

    const BULK_SIGLAS_SET = new Set(["CX", "FARD", "PAC"]);
    const byProd: Record<string, { unit: any | null; case: any | null; caseSigla: string | null }> = {};
    const prodOrder: string[] = [];
    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        if (!byProd[pid]) {
            byProd[pid] = { unit: null, case: null, caseSigla: null };
            prodOrder.push(pid);
        }
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN") byProd[pid].unit = r;
        if (BULK_SIGLAS_SET.has(sig) && !byProd[pid].case) {
            byProd[pid].case = r;
            byProd[pid].caseSigla = sig;
        }
    }

    const variants: VariantRow[] = [];
    for (const pid of prodOrder) {
        const unitPack = byProd[pid]?.unit ?? null;
        const casePack = byProd[pid]?.case ?? null;
        if (!unitPack && !casePack) continue;

        const p = unitPack ?? casePack;
        const volQty  = Number((unitPack ?? casePack)?.volume_quantidade ?? 0);
        const utSigla = String((unitPack ?? casePack)?.unit_type_sigla ?? "") || null;
        variants.push({
            id: String(unitPack?.id ?? casePack?.id ?? pid),
            productId: pid,
            productName: String(p?.product_name ?? ""),
            details: (unitPack?.descricao ?? casePack?.descricao ?? p?.product_details ?? null) as string | null,
            tags: unitPack?.tags ?? casePack?.tags ?? null,
            volumeValue: volQty,
            unit: String(p?.product_unit_type ?? "un"),
            unitTypeSigla: utSigla,
            unitPrice: Number(unitPack?.preco_venda ?? 0),
            hasCase: Boolean(casePack),
            caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
            casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
            bulkSigla: byProd[pid]?.caseSigla ?? null,
            caseVariantId: casePack ? String(casePack.id) : undefined,
            isAccompaniment: Boolean(unitPack?.is_acompanhamento || casePack?.is_acompanhamento),
        });
    }

    variants.sort((a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0));
    return variants;
}

/**
 * Busca variantes por texto livre com OR-scoring.
 *
 * Lógica de pontuação por variante:
 *   +4  → termo bate exatamente no início do nome do produto (ex: "skol" em "Skol Lata")
 *   +2  → termo contido em qualquer parte do nome do produto
 *   +1  → termo contido em tags ou detalhes
 *
 * Uma variante é incluída se QUALQUER termo bater em pelo menos um campo.
 * Resultados são ordenados por score decrescente → mais relevantes primeiro.
 *
 * Se nenhum resultado for encontrado via JS, faz uma segunda passagem com
 * queries .ilike() direto no Supabase (fallback para casos onde o cache
 * de 300 linhas não capturou o produto).
 */
async function searchVariantsByText(
    admin: SupabaseClient,
    companyId: string,
    searchInput: string | string[],
    limit = 10
): Promise<VariantRow[]> {
    // Novo modelo (produto_embalagens). Mantemos a implementação antiga como fallback,
    // mas delegamos para a nova função para não depender de `product_variants`.
    return searchVariantsByTextV2(admin, companyId, searchInput, limit);

    // Normaliza entrada → array de termos limpos (sem stopwords já removidas pelo caller)
    const terms: string[] = Array.isArray(searchInput)
        ? (searchInput as string[]).map((x: string) => normalize(x)).filter((t: string) => t.length >= 2)
        : normalize(searchInput as string).split(/\s+/).filter((t: string) => t.length >= 2);

    if (!terms.length) return [];

    console.log("[search] termos normalizados para busca:", terms);

    // ── Passagem 1: busca ampla em memória ────────────────────────────────────
    const { data, error } = await admin
        .from("product_variants")
        .select(`
            id, product_id, details, tags, volume_value, unit,
            unit_price, has_case, case_qty, case_price, is_accompaniment,
            products!inner(id, name, is_active)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(400);

    if (error) console.error("[search] erro Supabase:", error?.message);
    console.log("[search] variantes carregadas:", data?.length ?? 0);

    if (!data?.length) return [];

    type Scored = { row: VariantRow; score: number };
    const scored: Scored[] = [];

    for (const v of data as any[]) {
        const p = Array.isArray(v.products) ? v.products[0] : v.products;
        if (!p?.is_active) continue;

        const productName = normalize(String(p?.name ?? ""));
        const tagStr      = v.tags    ? normalize(String(v.tags))    : "";
        const detailStr   = v.details ? normalize(String(v.details)) : "";

        let totalScore = 0;

        for (const term of terms) {
            // Nome exato no início → prioridade máxima
            if (productName.startsWith(term))          totalScore += 4;
            // Nome contém o termo em qualquer posição
            else if (productName.includes(term))       totalScore += 2;

            // Tags: cada tag separada por vírgula é comparada individualmente
            if (tagStr) {
                const tagTokens = tagStr.split(/[,;]+/).map((t: string) => t.trim());
                if (tagTokens.some((t: string) => t.includes(term) || term.includes(t)))
                    totalScore += 1;
            }

            // Detalhes: busca simples de substring
            if (detailStr.includes(term)) totalScore += 1;
        }

        // Inclui se ao menos 1 ponto (qualquer match parcial)
        if (totalScore <= 0) continue;

        scored.push({
            score: totalScore,
            row: {
                id:              String(v.id),
                productId:       String(v.product_id),
                productName:     String(p?.name ?? ""),
                details:         v.details ?? null,
                tags:            v.tags    ?? null,
                volumeValue:     Number(v.volume_value ?? 0),
                unit:            v.unit ?? "ml",
                unitTypeSigla:   null,
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
                bulkSigla:       v.has_case ? "CX" : null,
                isAccompaniment: Boolean(v.is_accompaniment),
            },
        });
    }

    scored.sort((a, b) => b.score - a.score);
    const pass1 = scored.slice(0, limit).map((s) => s.row);

    console.log("[search] resultados pass1:", pass1.length, "| scores:", scored.slice(0, 5).map(s => `${s.row.productName}(${s.score})`));

    if (pass1.length > 0) return pass1;

    // ── Passagem 2: fallback via .ilike() no Supabase ─────────────────────────
    // Útil se o catálogo tiver mais de 400 variantes ou a variante estava inativa
    console.log("[search] pass1 vazia → tentando ilike fallback para termos:", terms);

    const ilikeFilters = terms.map((t) => `products.name.ilike.%${t}%`).join(",");
    const { data: fallbackData } = await admin
        .from("product_variants")
        .select(`
            id, product_id, details, tags, volume_value, unit,
            unit_price, has_case, case_qty, case_price, is_accompaniment,
            products!inner(id, name, is_active)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .or(ilikeFilters)
        .limit(limit);

    if (!fallbackData?.length) {
        console.log("[search] ilike fallback também não retornou resultados");
        return [];
    }

    console.log("[search] ilike fallback encontrou:", (fallbackData ?? []).length, "variantes");

    return ((fallbackData ?? []) as any[])
        .filter((v) => {
            const p = Array.isArray(v.products) ? v.products[0] : v.products;
            return p?.is_active;
        })
        .map((v) => {
            const p = Array.isArray(v.products) ? v.products[0] : v.products;
            return {
                id:              String(v.id),
                productId:       String(v.product_id),
                productName:     String(p?.name ?? ""),
                details:         v.details ?? null,
                tags:            v.tags    ?? null,
                volumeValue:     Number(v.volume_value ?? 0),
                unit:            v.unit ?? "ml",
                unitTypeSigla:   null,
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
                bulkSigla:       v.has_case ? "CX" : null,
                isAccompaniment: Boolean(v.is_accompaniment),
            };
        })
        .slice(0, limit);
}

// Nova implementação para o modelo atual: agrupa `produto_embalagens` (UN/CX)
// em uma estrutura do tipo `VariantRow` (que representa a "linha" de venda).
async function searchVariantsByTextV2(
    admin: SupabaseClient,
    companyId: string,
    searchInput: string | string[],
    limit = 10
): Promise<VariantRow[]> {
    const terms: string[] = Array.isArray(searchInput)
        ? searchInput.map(normalize).filter((t) => t.length >= 2)
        : normalize(searchInput).split(/\s+/).filter((t) => t.length >= 2);

    if (!terms.length) return [];

    const { data, error } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, is_acompanhamento, sigla_comercial, product_name, product_unit_type, product_details, volume_quantidade, unit_type_sigla")
        .eq("company_id", companyId)
        .limit(800);

    if (error) {
        console.error("[searchV2] erro Supabase:", error.message);
        return [];
    }
    if (!data?.length) return [];

    // Siglas que representam embalagem bulk (mais de 1 unidade)
    const BULK = new Set(["CX", "FARD", "PAC"]);

    // 1) Agrupar por produto
    const byProd: Record<string, {
        unitPack:  any | null;
        casePack:  any | null;
        caseSigla: string | null;
        tags:      string[];
    }> = {};

    for (const r of data as any[]) {
        const pid = String(r.produto_id);
        byProd[pid] ??= { unitPack: null, casePack: null, caseSigla: null, tags: [] };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN") byProd[pid].unitPack = r;
        // Aceita primeiro bulk encontrado (CX, FARD ou PAC)
        if (BULK.has(sig) && !byProd[pid].casePack) {
            byProd[pid].casePack  = r;
            byProd[pid].caseSigla = sig;
        }
        if (r.tags) byProd[pid].tags.push(String(r.tags));
    }

    const variants: VariantRow[] = Object.entries(byProd)
        .map(([pid, grp]) => {
            const unitPack = grp.unitPack ?? grp.casePack;
            const casePack = grp.casePack;
            if (!unitPack) return null;

            const volQty  = Number(unitPack.volume_quantidade ?? 0);
            const utSigla = String(unitPack.unit_type_sigla ?? "") || null;
            return {
                id:           String(unitPack.id),
                productId:    pid,
                productName:  String(unitPack.product_name ?? ""),
                details:      (unitPack.descricao ?? unitPack.product_details ?? null) as string | null,
                tags:         grp.tags.length ? grp.tags.join(",") : null,
                volumeValue:  volQty,
                unit:         String(unitPack.product_unit_type ?? "un"),
                unitTypeSigla: utSigla,
                unitPrice:    Number(unitPack.preco_venda ?? 0),
                hasCase:      Boolean(casePack),
                caseQty:      casePack ? Number(casePack.fator_conversao ?? 1) : null,
                casePrice:    casePack ? Number(casePack.preco_venda ?? 0) : null,
                bulkSigla:    grp.caseSigla,
                caseVariantId: casePack ? String(casePack.id) : undefined,
                isAccompaniment: Boolean(unitPack.is_acompanhamento || casePack?.is_acompanhamento),
            };
        })
        .filter(Boolean) as VariantRow[];

    // 2) Score JS (mesma ideia da versão antiga)
    type Scored = { row: VariantRow; score: number };
    const scored: Scored[] = [];

    for (const v of variants as any[]) {
        const productNameNorm = normalize(String(v.productName ?? ""));
        const tagStr = v.tags ? normalize(String(v.tags)) : "";
        const detailStr = v.details ? normalize(String(v.details)) : "";

        let totalScore = 0;
        for (const term of terms) {
            if (productNameNorm.startsWith(term)) totalScore += 4;
            else if (productNameNorm.includes(term)) totalScore += 2;

            if (tagStr) {
                const tagTokens = tagStr.split(/[,;]+/).map((t: string) => t.trim());
                if (tagTokens.some((t: string) => (t ? t.includes(term) : false) || (term ? term.includes(t) : false))) {
                    totalScore += 1;
                }
            }
            if (detailStr.includes(term)) totalScore += 1;
        }
        if (totalScore > 0) scored.push({ score: totalScore, row: v });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.row);
}

/**
 * Processador central de texto livre.
 * Extrai stopwords → quantidade → termos → busca no Supabase (OR scoring).
 *
 * Retorna:
 *   "handled"  → mensagem respondida, caller não precisa fazer nada
 *   "notfound" → nenhum produto encontrado (caller pode exibir fallback)
 *   "skip"     → input muito curto/só stopwords, caller trata normalmente
 */
async function handleFreeTextInput(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    rawInput: string,
    session: Session
): Promise<"handled" | "notfound" | "skip"> {
    // ── 0. Detecção de múltiplos endereços ───────────────────────────────────
    const multiAddrs = detectMultipleAddresses(rawInput);
    if (multiAddrs && multiAddrs.length >= 2) {
        await saveSession(admin, threadId, companyId, {
            step: "awaiting_split_order",
            context: {
                ...session.context,
                split_address_1: multiAddrs[0],
                split_address_2: multiAddrs[1],
            },
        });
        await reply(
            phoneE164,
            `Serão dois pedidos com pagamentos diferentes ou somente um pedido entregue em dois endereços?\n\n` +
            `1️⃣ Dois pedidos separados\n2️⃣ Um pedido, dois endereços`
        );
        return "handled";
    }

    // ── 0b. Detecção de endereço (+ produto combinado) na mesma mensagem ─────
    const addrMatch = extractAddressFromText(rawInput);
    if (addrMatch) {
        console.log("[freetext] endereço detectado:", addrMatch.full, "| bairro:", addrMatch.neighborhood);

        // Valida endereço via OrderParserService (Google Geocoding + restrição Sorriso-MT)
        const parser = getOrderParserService();
        const parsedAddr = await parser.validateAddress(addrMatch.full);

        const needsNumber = !parsedAddr?.houseNumber;

        const structuredAddr = parsedAddr
            ? {
                rua: parsedAddr.street ?? addrMatch.street,
                numero: parsedAddr.houseNumber ?? addrMatch.houseNumber,
                bairro: parsedAddr.neighborhood ?? addrMatch.neighborhood ?? "",
                cidade: "",
                estado: "",
                cep: "",
                placeId: parsedAddr.placeId ?? "",
                formatted: parsedAddr.formatted ?? addrMatch.full,
            }
            : null;

        if (needsNumber) {
            // Endereço incompleto (ex: sem número) → pedir apenas o número
            const textWithoutAddr = rawInput.replace(addrMatch.rawSlice, " ").trim();
            const needsNumPkg     = extractPackagingIntent(textWithoutAddr);
            const pTerms          = extractTerms(needsNumPkg.cleanText);
            const foundProducts   = pTerms.length >= 1 ? await searchVariantsByText(admin, companyId, pTerms) : [];
            const bestProduct = foundProducts[0] ?? null;
            const pQty        = needsNumPkg.qty;
            const bpIsCase    = isBulkPackaging(needsNumPkg.packagingSigla) && Boolean(bestProduct?.hasCase);
            let newCart = [...session.cart];
            if (bestProduct) {
                const name  = buildProductDisplayName(bestProduct, bpIsCase);
                const price = bpIsCase ? (bestProduct.casePrice ?? bestProduct.unitPrice) : bestProduct.unitPrice;
                const vId   = bpIsCase ? (bestProduct.caseVariantId ?? bestProduct.id) : bestProduct.id;
                const qty   = pQty >= 1 ? pQty : 1;
                const idx   = newCart.findIndex((c) => c.variantId === vId && Boolean(c.isCase) === bpIsCase);
                if (idx >= 0) newCart[idx] = { ...newCart[idx], qty: newCart[idx].qty + qty };
                else newCart.push({ variantId: vId, productId: bestProduct.productId, name, price, qty, isCase: bpIsCase, caseQty: bpIsCase ? (bestProduct.caseQty ?? undefined) : undefined });
            }
            await saveSession(admin, threadId, companyId, {
                step: "awaiting_address_number",
                cart: newCart,
                context: {
                    ...session.context,
                    address_draft: addrMatch.full,
                    delivery_address_structured: structuredAddr,
                    address_validation_error: "Informe o número do endereço",
                },
            });
            const prodMsg = bestProduct ? `✅ Anotado *${pQty >= 1 ? pQty : 1}x ${bestProduct.productName}*.\n\n` : "";
            await reply(
                phoneE164,
                `${prodMsg}📍 Endereço parcial: *${addrMatch.full}*\n\n` +
                `Qual é o *número* do endereço? (ex: 120, 456)`
            );
            return "handled";
        }

        // Endereço validado (ou fallback local)
        const deliveryAddress = parsedAddr?.formatted ?? addrMatch.full;
        const googleOk = Boolean(parsedAddr?.formatted);

        // Tenta encontrar produto na parte da mensagem sem o endereço
        const textWithoutAddr = rawInput.replace(addrMatch.rawSlice, " ").trim();
        const addrPkgIntent   = extractPackagingIntent(textWithoutAddr);
        const pQty            = addrPkgIntent.qty;
        const pTerms          = extractTerms(addrPkgIntent.cleanText);
        const foundProducts   = pTerms.length >= 1
            ? await searchVariantsByText(admin, companyId, pTerms)
            : [];
        const bestProduct = foundProducts[0] ?? null;
        const addrIsCase  = isBulkPackaging(addrPkgIntent.packagingSigla) && Boolean(bestProduct?.hasCase);

        // Busca zona de entrega (bairro do regex ou do Google)
        const neighborhoodForZone = structuredAddr?.bairro || addrMatch.neighborhood;
        let zone: DeliveryZone | null = null;
        if (neighborhoodForZone) {
            zone = await findDeliveryZone(admin, companyId, neighborhoodForZone);
        }

        // Salva endereço estruturado + taxa no contexto
        const newContext: Record<string, unknown> = {
            ...session.context,
            delivery_address:   deliveryAddress,
            delivery_fee:       zone?.fee ?? null,
            delivery_zone_id:   zone?.id  ?? null,
            delivery_address_structured: structuredAddr,
            delivery_address_place_id:   structuredAddr?.placeId ?? null,
            awaiting_neighborhood: !zone && !neighborhoodForZone ? true : (!zone && !!neighborhoodForZone),
            pending_neighborhood: !zone && neighborhoodForZone ? neighborhoodForZone : null,
        };

        let newCart = [...session.cart];

        // Adiciona produto ao carrinho se encontrado
        if (bestProduct) {
            const name  = buildProductDisplayName(bestProduct, addrIsCase);
            const price = addrIsCase ? (bestProduct.casePrice ?? bestProduct.unitPrice) : bestProduct.unitPrice;
            const vId   = addrIsCase ? (bestProduct.caseVariantId ?? bestProduct.id) : bestProduct.id;
            const qty   = pQty >= 1 ? pQty : 1;
            const idx   = newCart.findIndex((c) => c.variantId === vId && Boolean(c.isCase) === addrIsCase);
            if (idx >= 0) {
                newCart[idx] = { ...newCart[idx], qty: newCart[idx].qty + qty };
            } else {
                newCart.push({ variantId: vId, productId: bestProduct.productId, name, price, qty, isCase: addrIsCase, caseQty: addrIsCase ? (bestProduct.caseQty ?? undefined) : undefined });
            }
        }

        await saveSession(admin, threadId, companyId, {
            step:    "catalog_products",
            cart:    newCart,
            context: newContext,
        });

        // ── Caso combinado: produto + endereço + zona encontrada ─────────────
        if (bestProduct && zone) {
            const itemName = buildProductDisplayName(bestProduct, addrIsCase);
            const itemQty   = pQty >= 1 ? pQty : 1;
            const cartWithFee = cartTotal(newCart) + zone.fee;
            const addrLine = googleOk
                ? `Entendi, vou entregar na *${deliveryAddress}*`
                : `📍 Entrega na *${deliveryAddress}*`;
            await sendInteractiveButtons(
                phoneE164,
                `🍻 *Excelente escolha!*\n\n` +
                `✅ ${itemQty}x *${itemName}* anotado.\n` +
                `${addrLine}\n` +
                `🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*\n` +
                `💰 Total c/ entrega: *${formatCurrency(cartWithFee)}*\n\n` +
                `Algo mais ou deseja finalizar?`,
                [
                    { id: "mais_produtos", title: "Mais produtos"    },
                    { id: "finalizar",     title: "Finalizar pedido" },
                ]
            );
            return "handled";
        }

        // ── Endereço + produto, mas sem zona correspondente ──────────────────
        if (bestProduct && !zone) {
            const itemName = buildProductDisplayName(bestProduct, addrIsCase);
            const itemQty  = pQty >= 1 ? pQty : 1;
            if (addrMatch.neighborhood) {
                // Bairro digitado mas não cadastrado → listar opções
                const zones = await listDeliveryZones(admin, companyId);
                const zoneList = zones.length
                    ? zones.map((z) => `• ${z.label} — ${formatCurrency(z.fee)}`).join("\n")
                    : "_Nenhuma zona cadastrada ainda._";
                await reply(
                    phoneE164,
                    `✅ ${itemQty}x *${itemName}* anotado!\n` +
                    `📍 Endereço: *${addrMatch.street}, ${addrMatch.houseNumber}*\n\n` +
                    `⚠️ Não encontrei *${addrMatch.neighborhood}* nas nossas zonas de entrega.\n` +
                    `Atendemos estes bairros:\n\n${zoneList}\n\n` +
                    `_Pode confirmar o seu bairro?_`
                );
            } else {
                // Endereço sem bairro → pede o bairro
                await reply(
                    phoneE164,
                    `✅ ${itemQty}x *${itemName}* anotado!\n` +
                    `📍 Endereço: *${addrMatch.street}, ${addrMatch.houseNumber}*\n\n` +
                    `Para calcular a taxa de entrega, qual é o seu *bairro*?`
                );
            }
            return "handled";
        }

        // ── Apenas endereço (sem produto identificado) ───────────────────────
        // Confirmação silenciosa quando Google retornou algum resultado (googleOk)
        if (zone) {
            const cartSummary = newCart.length > 0 ? `\n\n🛒 *Pedido atual:*\n${formatCart(newCart)}` : "";
            const confirmMsg = googleOk
                ? `Entendi, vou entregar na *${deliveryAddress}*\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*${cartSummary}\n\nAlgo mais ou posso fechar?`
                : `📍 Endereço anotado: *${deliveryAddress}*\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*${cartSummary}\n\nAlgo mais ou posso fechar?`;
            await sendInteractiveButtons(
                phoneE164,
                confirmMsg,
                [
                    { id: "mais_produtos", title: "Mais produtos"    },
                    { id: "finalizar",     title: "Finalizar pedido" },
                ]
            );
        } else if (addrMatch.neighborhood) {
            const zones    = await listDeliveryZones(admin, companyId);
            const zoneList = zones.length
                ? zones.map((z) => `• ${z.label} — ${formatCurrency(z.fee)}`).join("\n")
                : "_Nenhuma zona cadastrada._";
            await reply(
                phoneE164,
                `📍 Endereço: *${addrMatch.street}, ${addrMatch.houseNumber}*\n\n` +
                `⚠️ Não encontrei *${addrMatch.neighborhood}* nas zonas de entrega.\n` +
                `Atendemos:\n\n${zoneList}\n\n_Confirme seu bairro:_`
            );
        } else {
            await reply(
                phoneE164,
                `📍 Endereço anotado: *${addrMatch.street}, ${addrMatch.houseNumber}*\n\n` +
                `Para calcular o frete, qual é o seu *bairro*?`
            );
        }
        return "handled";
    }

    // ── 1. Extração de embalagem + quantidade + texto limpo ──────────────────
    const pkgIntent = extractPackagingIntent(rawInput);
    const { qty, packagingSigla, cleanText, isExplicit: pkgExplicit } = pkgIntent;

    console.log(`[freetext] input: "${rawInput}" | pkg=${packagingSigla ?? "none"} qty=${qty} cleanText="${cleanText}"`);

    // Remove stopwords do cleanText para busca no banco
    const terms = extractTerms(cleanText);

    if (!terms.length) {
        console.log("[freetext] → skip (sem termos de produto após extração)");
        return "skip";
    }

    console.log(`[freetext] termos de busca: [${terms.join(", ")}] | quantidade: ${qty} | embalagem: ${packagingSigla ?? "não especificada"}`);

    const found = await searchVariantsByText(admin, companyId, terms);

    // Filtra pelo tipo de embalagem pedido (ex: "cx" → só produtos com CX)
    const { filtered: foundFiltered, wasFiltered } = filterVariantsByPackaging(found, packagingSigla);

    console.log(`[freetext] total encontrados: ${found.length} | após filtro embalagem: ${foundFiltered.length}`);

    // ── Nenhum resultado ──────────────────────────────────────────────────────
    if (!found.length) {
        console.log("[freetext] → notfound (nenhuma variante correspondeu)");
        return "notfound";
    }

    // Se pediu embalagem bulk (CX/FARD/PAC) mas nenhum produto tem ela → avisa
    if (pkgExplicit && isBulkPackaging(packagingSigla) && !wasFiltered) {
        const pkgNome = packagingLabel(packagingSigla);
        await reply(
            phoneE164,
            `⚠️ Encontrei o produto, mas ele não está disponível por *${pkgNome}*.\n` +
            `Posso oferecer por *unidade*. Quantas unidades deseja?`
        );
        // Continua para o fluxo normal com found (sem filtro)
    }

    // Lista efetiva a usar
    const effective = wasFiltered ? foundFiltered : found;

    // ── Produto sem volume especificado → mostrar variantes ───────────────────
    // Se o usuário não especificou volume E os resultados são do mesmo produto (1 produto, possivelmente 1 variante)
    if (!hasVolumeClue(cleanText) && !pkgExplicit && effective.length >= 1) {
        // Group by productId (more reliable than productName)
        const byProductId = new Map<string, VariantRow[]>();
        for (const v of effective) {
            const key = v.productId;
            if (!byProductId.has(key)) byProductId.set(key, []);
            byProductId.get(key)!.push(v);
        }

        // Only show variant selection when all results are the same product
        if (byProductId.size === 1) {
            const variants = [...byProductId.values()][0];
            const displayName = effective[0].productName;
            const displayVariants: VariantRow[] = [];
            for (const v of variants) {
                displayVariants.push(v); // UN variant
                // Add CX variant as separate entry if exists
                if (v.hasCase && v.caseVariantId) {
                    displayVariants.push({
                        ...v,
                        id: v.caseVariantId,
                        unitPrice: v.casePrice ?? v.unitPrice,
                    });
                }
            }

            if (displayVariants.length >= 1) {
                const listLines = displayVariants.slice(0, 9).map((v, i) => {
                    const emoji = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
                    const isCase = variants.some(orig => orig.caseVariantId === v.id && orig.id !== v.id);
                    const name = buildProductDisplayName(v, isCase);
                    return `${emoji} *${name}* — ${formatCurrency(v.unitPrice)}`;
                });
                await saveSession(admin, threadId, companyId, {
                    step: "awaiting_variant_selection",
                    context: {
                        ...session.context,
                        variant_options: displayVariants.slice(0, 9),
                        variant_qty: qty,
                    },
                });
                await reply(
                    phoneE164,
                    `🍺 *${displayName}* — qual opção você quer?\n\n${listLines.join("\n")}\n\n_Digite o número da opção. Para pedir vários: "1 2 3" ou "3x1" para 3 unidades da opção 1_`
                );
                return "handled";
            }
        }
    }

    // ── Match único ───────────────────────────────────────────────────────────
    if (effective.length === 1) {
        const v = effective[0];

        // Decide se é venda em caixa/bulk: cliente explicitou OU produto só tem CX
        const forceCase = pkgExplicit && isBulkPackaging(packagingSigla) && v.hasCase;
        const isCase    = forceCase;
        const name      = buildProductDisplayName(v, isCase);
        const price     = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
        const varId     = isCase ? (v.caseVariantId ?? v.id) : v.id;

        // Tem qty explícita OU embalagem explícita → adiciona ao carrinho direto
        if (qty > 1 || isCase) {
            const newItem: CartItem = {
                variantId: varId,
                productId: v.productId,
                name,
                price,
                qty,
                isCase,
                caseQty: isCase ? (v.caseQty ?? undefined) : undefined,
            };
            const existingIdx = session.cart.findIndex(
                (i) => i.variantId === varId && Boolean(i.isCase) === isCase
            );
            const newCart = [...session.cart];
            if (existingIdx >= 0) {
                newCart[existingIdx] = { ...newCart[existingIdx], qty: newCart[existingIdx].qty + qty };
            } else {
                newCart.push(newItem);
            }

            await saveSession(admin, threadId, companyId, {
                step: "catalog_products",
                cart: newCart,
                context: {
                    ...session.context,
                    variants:        found,
                    brand_name:      "Resultados",
                    category_name:   "Busca",
                    pending_variant: null,
                    pending_is_case: null,
                },
            });

            await sendInteractiveButtons(
                phoneE164,
                `✅ Certo! Adicionei *${qty}x ${name}* (${formatCurrency(price * qty)}) ao seu pedido.\n\n${formatCart(newCart)}\n\nDeseja mais alguma coisa ou podemos fechar?`,
                [
                    { id: "mais_produtos", title: "Mais produtos" },
                    { id: "ver_carrinho",  title: "Ver carrinho" },
                    { id: "finalizar",     title: "Finalizar pedido" },
                ]
            );
            return "handled";
        }

        // Sem quantidade e sem embalagem explícita → pergunta quanto quer
        // Se tem opção de caixa, mostra as duas opções numeradas
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_products",
            context: {
                ...session.context,
                variants:         found,
                brand_name:       "Resultados",
                category_name:    "Busca",
                pending_variant:  v,
                pending_is_case:  false,
                unit_case_choice: Boolean(v.hasCase && v.casePrice),
            },
        });

        if (v.hasCase && v.casePrice) {
            const cxName  = buildProductDisplayName(v, true);
            const unName  = buildProductDisplayName(v, false);
            const pkgNome = packagingLabel(v.bulkSigla);
            await reply(
                phoneE164,
                `Encontrei:\n\n` +
                `1. *${unName}* — ${formatCurrency(v.unitPrice)}\n` +
                `2. *${cxName}* — ${formatCurrency(v.casePrice)}\n\n` +
                `Qual opção deseja? Digite *1* ou *2* e a quantidade (ex: *2 caixas*).`
            );
        } else {
            const unName = buildProductDisplayName(v, false);
            await reply(
                phoneE164,
                `Encontrei *${unName}* por *${formatCurrency(v.unitPrice)}*. 🍺\n\nQuantas unidades deseja?`
            );
        }
        return "handled";
    }

    // ── Múltiplos resultados → lista numerada em texto puro ──────────────────
    const MAX_SHOWN = 5;
    const displayed = effective.slice(0, MAX_SHOWN);
    const hasMore   = effective.length > MAX_SHOWN;

    await saveSession(admin, threadId, companyId, {
        step:    "catalog_products",
        context: {
            ...session.context,
            variants:        found,
            brand_name:      "Resultados",
            category_name:   "Busca",
            pending_variant: null,
            pending_is_case: null,
            search_numbered: true,
        },
    });

    const listText = formatNumberedList(displayed);
    const moreHint = hasMore
        ? `\n\n_Mostrando ${MAX_SHOWN} de ${effective.length} opções. Digite o nome para refinar a busca._`
        : "";
    const multiHint = displayed.length > 1
        ? `\n\nDigite o *número* da opção (ex: *2*) ou *vários* separados por vírgula (ex: *1,3*).`
        : "";

    await reply(
        phoneE164,
        `🔍 Encontrei estas opções:\n\n${listText}${moreHint}${multiHint}`
    );
    return "handled";
}

/** Busca itens de acompanhamento para sugerir após pedido fechado.
 *  Se cartEmbalagemIds for informado, usa produto_embalagem_acompanhamentos (produtos vinculados ao que comprou).
 *  Caso contrário, fallback para embalagens com is_acompanhamento=true. */
async function getAccompanimentItems(
    admin: SupabaseClient,
    companyId: string,
    cartEmbalagemIds?: string[]
): Promise<VariantRow[]> {
    const out: VariantRow[] = [];
    const seen = new Set<string>();

    if (cartEmbalagemIds?.length) {
        const { data: acRows } = await admin
            .from("produto_embalagem_acompanhamentos")
            .select("acompanhamento_produto_embalagem_id")
            .in("produto_embalagem_id", cartEmbalagemIds)
            .order("ordem");

        const acompIds = [...new Set(((acRows ?? []) as any[]).map((r) => String(r.acompanhamento_produto_embalagem_id)))];
        if (acompIds.length) {
            const { data: packs } = await admin
                .from("view_chat_produtos")
                .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, product_name")
                .in("id", acompIds)
                .eq("company_id", companyId);

            for (const r of (packs ?? []) as any[]) {
                if (seen.has(String(r.id))) continue;
                seen.add(String(r.id));
                out.push({
                    id: String(r.id),
                    productId: String(r.produto_id),
                    productName: String(r.product_name ?? ""),
                    details: (r.descricao ?? null) as string | null,
                    tags: r.tags ?? null,
                    volumeValue: 0,
                    unit: "un",
                    unitTypeSigla: null,
                    unitPrice: Number(r.preco_venda ?? 0),
                    hasCase: false,
                    caseQty: null,
                    casePrice: null,
                    bulkSigla: null,
                    caseVariantId: undefined,
                    isAccompaniment: true,
                });
                if (out.length >= 5) break;
            }
        }
    }

    if (out.length < 5) {
        const { data: accompPacks } = await admin
            .from("view_chat_produtos")
            .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, sigla_comercial, product_name, product_unit_type, product_details")
            .eq("company_id", companyId)
            .eq("is_acompanhamento", true)
            .limit(50);

        const safeAcc = (accompPacks ?? []) as any[];
        if (safeAcc.length) {
            const produtoIds = [...new Set(safeAcc.map((p) => String(p.produto_id)))].slice(0, 20);
            const { data: packs } = await admin
                .from("view_chat_produtos")
                .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, sigla_comercial, product_name, product_unit_type, product_details")
                .in("produto_id", produtoIds)
                .eq("company_id", companyId);

            const byProd: Record<string, { unitPack: any | null; casePack: any | null; tags: string[] }> = {};
            for (const r of (packs ?? []) as any[]) {
                const pid = String(r.produto_id);
                byProd[pid] ??= { unitPack: null, casePack: null, tags: [] };
                const sig = String(r.sigla_comercial ?? "").toUpperCase();
                if (r.tags) byProd[pid].tags.push(String(r.tags));
                if (sig === "UN") byProd[pid].unitPack = r;
                if (sig === "CX") byProd[pid].casePack = r;
            }

            for (const pid of produtoIds) {
                if (out.length >= 5) break;
                const grp = byProd[pid];
                if (!grp) continue;
                const unitPack = grp.unitPack ?? grp.casePack;
                const casePack = grp.casePack;
                if (!unitPack || seen.has(String(unitPack.id))) continue;
                seen.add(String(unitPack.id));
                out.push({
                    id: String(unitPack.id),
                    productId: pid,
                    productName: String(unitPack.product_name ?? ""),
                    details: (unitPack.descricao ?? unitPack.product_details ?? null) as string | null,
                    tags: grp.tags.length ? grp.tags.join(",") : null,
                    volumeValue: 0,
                    unit: String(unitPack.product_unit_type ?? "un"),
                    unitTypeSigla: null,
                    unitPrice: Number(unitPack.preco_venda ?? 0),
                    hasCase: Boolean(casePack),
                    caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
                    casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
                    bulkSigla: casePack ? String(casePack.sigla_comercial ?? "CX").toUpperCase() : null,
                    caseVariantId: casePack ? String(casePack.id) : undefined,
                    isAccompaniment: true,
                });
            }
        }
    }

    return out.slice(0, 5);
}

// ─── DB: Cliente ──────────────────────────────────────────────────────────────

interface Customer {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
}

async function getOrCreateCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneE164: string,
    name?: string | null
): Promise<Customer | null> {
    const phoneClean = phoneE164.replace(/\D/g, "");

    const { data: existing } = await admin
        .from("customers")
        .select("id, name, phone, address, is_adult")
        .eq("company_id", companyId)
        .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
        .limit(1)
        .maybeSingle();

    if (existing) return existing as Customer;

    const { data: created, error } = await admin
        .from("customers")
        .insert({ company_id: companyId, name: name ?? "Cliente WhatsApp", phone: phoneE164 })
        .select("id, name, phone, address, is_adult")
        .single();

    if (error) {
        console.error("[chatbot] Erro ao criar customer:", error.message, "| company:", companyId, "| phone:", phoneE164);
        return null;
    }

    return created as Customer;
}

// ─── DB: Pedido ───────────────────────────────────────────────────────────────

/**
 * payment_method aceita: "pix" | "cash" | "card"
 * delivery_address é coluna real em orders.
 * details é reservado para observações do dashboard (ex: "recolher cascos").
 */
async function createOrder(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    cart: CartItem[],
    paymentMethod: string,
    deliveryAddress: string,
    changeFor?: number | null,
    deliveryFee = 0
): Promise<string> {
    const total = cartTotal(cart) + deliveryFee;

    console.log("[createOrder] dados:", JSON.stringify({
        company_id:     companyId,
        customer_id:    customerId,
        cart,
        address:        deliveryAddress,
        payment_method: paymentMethod,
        change_for:     changeFor ?? null,
    }, null, 2));

    const orderPayload = {
        company_id:       companyId,
        customer_id:      customerId,
        status:           "new",
        channel:          "whatsapp",
        payment_method:   paymentMethod,
        paid:             false,
        delivery_fee:     deliveryFee,
        total:            total,
        total_amount:     total,
        change_for:       changeFor ?? null,
        delivery_address: deliveryAddress,
        // details: reservado para observações do dashboard — não poluir com dados do pedido
    };

    console.log("[createOrder] inserindo order...");
    const { data: order, error: orderErr } = await admin
        .from("orders")
        .insert(orderPayload)
        .select()
        .single();

    console.log("[createOrder] order result:", order, orderErr);

    if (orderErr || !order?.id) {
        console.error("[createOrder] FALHA ao inserir order:", {
            code:    orderErr?.code,
            message: orderErr?.message,
            details: orderErr?.details,
            hint:    orderErr?.hint,
        });
        throw new Error(orderErr?.message ?? "Falha ao criar pedido");
    }

    const items = cart.map((item) => ({
        order_id:           order.id,
        company_id:         companyId,
        product_id:         item.productId,
        produto_embalagem_id: item.variantId,
        product_name:       item.name,
        quantity:           item.qty,
        qty:                item.qty,
        unit_price:         item.price,
        unit_type:          item.isCase ? "case" : "unit",
        // line_total é coluna gerada no banco; não deve ser enviada
    }));

    console.log("[createOrder] inserindo", items.length, "itens...");

    const { error: itemsErr } = await admin.from("order_items").insert(items);

    if (itemsErr) {
        console.error("[createOrder] FALHA ao inserir itens:", {
            code:    itemsErr.code,
            message: itemsErr.message,
            details: itemsErr.details,
            hint:    itemsErr.hint,
            items,
        });
        throw new Error(itemsErr.message ?? "Falha ao criar itens do pedido");
    }

    // Débito de estoque fica a cargo do trigger em `order_items` (produto_embalagem_id → fator_conversao).

    console.log("[createOrder] concluído | orderId:", order.id);
    return order.id as string;
}

// ─── Horário de funcionamento ─────────────────────────────────────────────────

function isWithinBusinessHours(settings: Record<string, unknown>): boolean {
    const bh = settings?.business_hours as Record<string, { open?: boolean; from?: string; to?: string }> | undefined;
    if (!bh) return true;

    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const now      = new Date();
    const day      = bh[dayNames[now.getDay()]];

    if (!day?.open) return false;

    const [openH,  openM]  = (day.from ?? "08:00").split(":").map(Number);
    const [closeH, closeM] = (day.to   ?? "22:00").split(":").map(Number);
    const nowMin           = now.getHours() * 60 + now.getMinutes();

    return nowMin >= openH * 60 + openM && nowMin < closeH * 60 + closeM;
}

// ─── Helpers de exibição ──────────────────────────────────────────────────────

/** Trunca para o limite de 24 chars do title em list_message do WhatsApp. */
function truncateTitle(text: string, maxLen = 24): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
}

// ─── Envio ────────────────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, messageId, phoneE164, text, profileName } = params;

    console.log("[chatbot] processInboundMessage START | thread:", threadId, "company:", companyId, "text:", text);

    const input = text.trim();
    if (!input) {
        console.log("[chatbot] input vazio, ignorando");
        return;
    }

    // Verifica se existe bot ativo para esta empresa e carrega config
    const { data: botRows, error: botErr } = await admin
        .from("chatbots")
        .select("id, config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    console.log("[chatbot] chatbots ativos:", botRows?.length ?? 0, botErr ? `| erro: ${botErr.message}` : "");

    if (!botRows?.length) {
        console.warn("[chatbot] Nenhum chatbot ativo para company:", companyId, "— verifique tabela chatbots");
        return;
    }

    const botConfig = (botRows[0]?.config as Record<string, unknown>) ?? {};

    const [company, session] = await Promise.all([
        getCompanyInfo(admin, companyId),
        getOrCreateSession(admin, threadId, companyId),
    ]);

    const companyName = company?.name ?? "nossa loja";
    const settings    = company?.settings ?? {};

    console.log("[chatbot] session step:", session.step, "| cartItems:", session.cart.length, "| input:", input);

    // ── 1. Global reset (menu/oi/ola/reiniciar — WITHOUT cancelar) ───────────
    if (matchesAny(input, ["limpar", "reiniciar", "menu", "inicio", "comecar", "oi", "ola", "hello", "hi", "esvaziar"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await reply(phoneE164, buildMainMenu(companyName));
        return;
    }

    // ── 2. Handover ───────────────────────────────────────────────────────────
    if (matchesAny(input, ["atendente", "humano", "pessoa", "falar com alguem", "ajuda"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // ── 3. Detecção de nome do cliente (must run EARLY) ───────────────────────
    const detectedName = extractClientName(input);
    if (detectedName) {
        // Always save to context
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, client_name: detectedName },
        });
        session.context.client_name = detectedName;
        // Only update DB if customer_id exists
        if (session.customer_id) {
            await admin.from("customers").update({ name: detectedName }).eq("id", session.customer_id);
        }
        await reply(phoneE164, `Olá, *${detectedName}*! 😊 Como posso te ajudar?`);
        return;
    }

    // ── 4. Remove intent (retira/tira/cancela + product) — before cancelar-alone check ──
    if (detectRemoveIntent(input) && session.cart.length > 0) {
        const normIn = normalize(input);
        const withoutVerb = normIn.replace(/\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/gi, "").trim();
        const removeTerms = withoutVerb.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
        if (removeTerms.length > 0) {
            const idx = session.cart.findIndex((c) => removeTerms.some((t) => normalize(c.name).includes(t)));
            if (idx >= 0) {
                const item = session.cart[idx];
                const newCart = session.cart.filter((_, i) => i !== idx);
                await saveSession(admin, threadId, companyId, { cart: newCart });
                await reply(
                    phoneE164,
                    `🗑️ *${item.name}* removido do pedido.\n\n${newCart.length > 0 ? formatCart(newCart) : "Carrinho vazio."}`
                );
                return;
            }
        }
    }

    // ── 5. Cancel handling (cancelar alone → awaiting_cancel_confirm; cancelar + product → remove) ──
    const isCancelarInput = /\b(cancelar|cancela)\b/i.test(input);
    if (isCancelarInput) {
        const normIn = normalize(input);
        const withoutCancel = normIn.replace(/\b(cancelar|cancela)\b/g, "").trim();
        const cancelTerms = withoutCancel.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));

        if (cancelTerms.length > 0) {
            // Has product terms → try to remove from cart
            if (session.cart.length > 0) {
                const idx = session.cart.findIndex((c) =>
                    cancelTerms.some((t) => normalize(c.name).includes(t))
                );
                if (idx >= 0) {
                    const item = session.cart[idx];
                    const newCart = [...session.cart];
                    if (item.qty > 1) {
                        newCart[idx] = { ...item, qty: item.qty - 1 };
                        await saveSession(admin, threadId, companyId, { cart: newCart, context: session.context });
                        await reply(phoneE164, `↩️ *${item.name}*: agora ${item.qty - 1}x no carrinho.`);
                    } else {
                        newCart.splice(idx, 1);
                        await saveSession(admin, threadId, companyId, { cart: newCart, context: session.context });
                        await reply(phoneE164, `🗑️ *${item.name}* removido do carrinho.`);
                    }
                    return;
                }
            }
            // No match in cart → fall through to normal flow (might be a product search)
        } else {
            // "cancelar" alone → ask confirmation (unless already in awaiting_cancel_confirm)
            if (session.step !== "awaiting_cancel_confirm") {
                await saveSession(admin, threadId, companyId, {
                    step: "awaiting_cancel_confirm",
                    context: { ...session.context, pre_cancel_step: session.step },
                });
                await reply(phoneE164, "⚠️ Tem certeza que quer *cancelar o pedido*?\n\nResponda *sim* para confirmar ou *não* para continuar.");
                return;
            }
        }
    }

    // ── 6. awaiting_cancel_confirm step handler ───────────────────────────────
    if (session.step === "awaiting_cancel_confirm") {
        const isYes = /\b(sim|s|yes|pode|confirm|cancela|cancelo)\b/i.test(normalize(input));
        const isNo  = /\b(nao|n|no|nope|voltar|continuar|nao quero)\b/i.test(normalize(input));
        if (isYes) {
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await reply(phoneE164, buildMainMenu(companyName));
        } else if (isNo) {
            const prevStep = (session.context.pre_cancel_step as string) ?? "main_menu";
            await saveSession(admin, threadId, companyId, { step: prevStep, context: { ...session.context, pre_cancel_step: undefined } });
            await reply(phoneE164, "Ok, continuando seu pedido! 😊");
        } else {
            await reply(phoneE164, "Responda *sim* para cancelar o pedido ou *não* para continuar.");
        }
        return;
    }

    // ── 7. Affirmative/negative global (checkout_confirm + other steps) ───────
    {
        const isAffirmative = /\b(sim|s|yes|continuar|continue|blz|ok|pode|beleza|top|certo|perfeito|exato|claro|positivo|vai|bora|isso|manda)\b/i.test(input);
        if (isAffirmative && session.step === "checkout_confirm") {
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, "confirmar", session);
            return;
        }
    }

    // ── 8. Checkout keywords ──────────────────────────────────────────────────
    const CHECKOUT_KEYWORDS = ["fechar pedido","fechar","pagar","finalizar","acabou","checkout","quero pagar","fecha","bater caixa","vou pagar","quero finalizar","vou finalizar","pode fechar","fecha ai","bater o caixa","quero fechar","encerrar","terminar","quero confirmar"];
    if (matchesAny(input, CHECKOUT_KEYWORDS) && session.cart.length > 0) {
        console.log("[chatbot] atalho de checkout detectado | cart:", session.cart.length);
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    // ── 9. Payment detection for payment step (any message length) ────────────
    const PAYMENT_STEP = "checkout_payment";
    if (session.step === PAYMENT_STEP) {
        const detectedPayment = detectPaymentMethod(input);
        if (detectedPayment) {
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, input, session);
            return;
        }
    }

    // ── 10. Detect multiple delivery addresses in one message ─────────────────
    const multipleAddresses = detectMultipleAddresses(input);
    if (multipleAddresses && multipleAddresses.length >= 2 && session.step !== "awaiting_split_order") {
        await saveSession(admin, threadId, companyId, {
            step: "awaiting_split_order",
            cart: session.cart,
            context: { ...session.context, split_address_1: multipleAddresses[0], split_address_2: multipleAddresses[1] },
        });
        await sendInteractiveButtons(
            phoneE164,
            `📍 Percebi *dois endereços* na sua mensagem:\n\n• *${multipleAddresses[0]}*\n• *${multipleAddresses[1]}*\n\nSerão dois pedidos separados ou um pedido em dois endereços?`,
            [
                { id: "split_yes", title: "Dois pedidos" },
                { id: "split_no",  title: "Um pedido" },
            ]
        );
        return;
    }

    // ── 11. Interceptor global: ParserFactory (Claude→Regex→Assisted) ─────────
    // Toda mensagem passa primeiro pelo parser; produtos são adicionados (merge), endereço validado com Google
    if (input.length >= 3) {
        const products = await getCachedProducts(admin, companyId);
        const parsed = await parseWithFactory({
            admin,
            companyId,
            threadId,
            messageId,
            input,
            products,
            claudeConfig: {
                model:      String(botConfig.model   ?? "claude-haiku-4-5-20251001"),
                threshold:  Number(botConfig.threshold ?? 0.75),
                maxRetries: Number(botConfig.max_retries ?? 2),
                timeoutMs:  Number(botConfig.timeout_ms  ?? 8000),
            },
        });

        if (parsed.action === "add_to_cart" && parsed.items.length > 0) {
            const toAdd = parsedItemsToCartItems(parsed.items);
            const newCart = mergeCart(session.cart, toAdd);
            const ctx: Record<string, unknown> = { ...session.context, consecutive_unknown_count: 0 };

            if (parsed.contextUpdate?.delivery_address) {
                const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
                const zone = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
                Object.assign(ctx, parsed.contextUpdate, {
                    delivery_fee: zone?.fee ?? ctx.delivery_fee,
                    delivery_zone_id: zone?.id ?? ctx.delivery_zone_id,
                });
            } else {
                Object.assign(ctx, parsed.contextUpdate);
            }

            // Detecta método de pagamento na mesma mensagem
            const detectedPmInCart = detectPaymentMethod(input);
            if (detectedPmInCart && !ctx.payment_method) {
                ctx.payment_method = detectedPmInCart;
            }

            await saveSession(admin, threadId, companyId, { cart: newCart, context: ctx });

            // Se endereço + pagamento detectados → ir para checkout_confirm
            if (ctx.delivery_address && ctx.payment_method) {
                await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, cart: newCart, context: ctx });
                return;
            }

            const stepLabels: Record<string, string> = {
                main_menu: "menu",
                catalog_categories: "categorias",
                catalog_products: "catálogo",
                cart: "carrinho",
                checkout_address: "endereço",
                checkout_payment: "pagamento",
                checkout_confirm: "confirmação",
            };
            const stepLabel = stepLabels[session.step] ?? "pedido";
            const itemList = parsed.items.map((i) => `${i.qty}x ${i.name}`).join(", ");
            await reply(
                phoneE164,
                `✅ Adicionado ${itemList}!\n\nSeu pedido agora tem *${newCart.length}* itens.\n\n` +
                `Podemos continuar com *${stepLabel}* ou quer algo mais?`
            );
            return;
        }

        if (parsed.action === "add_to_cart" && parsed.items.length === 0 && parsed.contextUpdate?.delivery_address) {
            const rawAddr = parsed.contextUpdate.delivery_address as string;
            const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
            const zone = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
            const ctx: Record<string, unknown> = {
                ...session.context,
                ...parsed.contextUpdate,
                delivery_fee: zone?.fee ?? null,
                delivery_zone_id: zone?.id ?? null,
                saved_address: null,
                awaiting_address: false,
                consecutive_unknown_count: 0,
            };
            await saveSession(admin, threadId, companyId, { context: ctx });
            const formatted = rawAddr;
            const feeText = zone ? `\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*` : "";
            const cartText = session.cart.length > 0 ? `\n\n🛒 *Pedido:*\n${formatCart(session.cart)}` : "";
            await reply(phoneE164, `📍 Endereço atualizado: *${formatted}*${feeText}${cartText}`);
            // Se já existe carrinho → pular para checkout (prioridade de endereço)
            if (session.cart.length > 0) {
                await goToCheckoutFromCart(
                    admin,
                    companyId,
                    threadId,
                    phoneE164,
                    { ...session, context: ctx }
                );
                return;
            }

            // Sem carrinho: pedir para selecionar produtos (catálogo)
            const categories = await getCategories(admin, companyId);
            if (categories.length) {
                await saveSession(admin, threadId, companyId, {
                    step: "catalog_categories",
                    context: { ...ctx, categories, consecutive_unknown_count: 0 },
                });
                await sendListMessage(
                    phoneE164,
                    "🍺 Escolha uma categoria para ver os produtos:",
                    "Ver categorias",
                    categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
                    "Categorias"
                );
                return;
            }

            return;
        }

        if (parsed.action === "confirm_order") {
            const toAdd = parsedItemsToCartItems(parsed.items);
            const newCart = mergeCart(session.cart, toAdd);
            const neighborhood = parsed.address?.neighborhood ?? null;
            const zone = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
            const ctx: Record<string, unknown> = {
                ...session.context,
                ...parsed.contextUpdate,
                delivery_fee: zone?.fee ?? null,
                delivery_zone_id: zone?.id ?? null,
                consecutive_unknown_count: 0,
            };
            await saveSession(admin, threadId, companyId, { cart: newCart, context: ctx });
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, cart: newCart, context: ctx });
            return;
        }

        // ── Prioridade de endereço: low_confidence / product_not_found ─────────
        // Se o OrderParserService detectou endereço, aplicamos mesmo fora do step atual.
        // - Com carrinho: pular para checkout
        // - Sem carrinho: remover endereço do input e deixar o chatbot buscar/selecionar produtos
        if (
            (parsed.action === "low_confidence" || parsed.action === "product_not_found") &&
            parsed.contextUpdate?.delivery_address
        ) {
            const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
            const zone = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;

            const addrCtx: Record<string, unknown> = {
                ...session.context,
                ...parsed.contextUpdate,
                delivery_fee: zone?.fee ?? null,
                delivery_zone_id: zone?.id ?? null,
                consecutive_unknown_count: 0,
            };

            await saveSession(admin, threadId, companyId, { context: addrCtx });

            if (session.cart.length > 0) {
                await goToCheckoutFromCart(
                    admin,
                    companyId,
                    threadId,
                    phoneE164,
                    { ...session, context: addrCtx }
                );
                return;
            }

            // Remove o endereço do texto para focar em produtos
            const addrMatch = extractAddressFromText(input);
            const cleanedInput = addrMatch
                ? input.replace(addrMatch.rawSlice, " ").trim()
                : input;

            const ftResult = await handleFreeTextInput(
                admin,
                companyId,
                threadId,
                phoneE164,
                cleanedInput,
                { ...session, context: addrCtx }
            );

            if (ftResult === "handled") return;
            // Se não encontrar produto, deixa o fluxo normal seguir (fallback/menu)
        }

        if (parsed.action === "low_confidence") {
            const FREE_TEXT_STEPS = ["main_menu", "welcome", "catalog_products", "cart"];
            if (!FREE_TEXT_STEPS.includes(session.step)) {
                const didFallback = await handleLowConfidenceFallback(
                    admin, companyId, threadId, phoneE164, companyName, session
                );
                if (didFallback) return;
            }
        }
    }

    // ── Roteamento por etapa ─────────────────────────────────────────────────

    switch (session.step) {
        case "welcome":
        case "main_menu":
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, session, profileName);
            break;

        case "catalog_categories":
            await handleCatalogCategories(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "catalog_brands":
            // Legado: redireciona para categorias (marca removida)
            await saveSession(admin, threadId, companyId, { step: "catalog_categories", context: {} });
            await handleCatalogCategories(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "catalog_products":
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "catalog_variant":
            // Legado: redireciona para catalog_products
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "cart":
            await handleCart(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "checkout_address":
            await handleCheckoutAddress(admin, companyId, threadId, phoneE164, input, session, profileName);
            break;

        case "awaiting_address_number":
            await handleAwaitingAddressNumber(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "awaiting_address_neighborhood":
            await handleAwaitingAddressNeighborhood(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "checkout_payment":
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "checkout_confirm":
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "awaiting_cancel_confirm":
            // Handled above in global commands section (step 6)
            break;

        case "awaiting_variant_selection":
            await handleAwaitingVariantSelection(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "awaiting_split_order":
            await handleAwaitingSplitOrder(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "handover":
            // Bot silenciado — humano está atendendo
            break;

        case "done":
            // Pedido já confirmado → volta ao menu no próximo contato
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await reply(phoneE164, buildMainMenu(companyName));
            break;

        default:
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await reply(phoneE164, buildMainMenu(companyName));
    }
}

// ─── WELCOME / MAIN MENU ──────────────────────────────────────────────────────

/** Apenas as opções 1,2,3 — usado quando busca falha (sem repetir saudação) */
function getMenuOptionsOnly(): string {
    return `Como posso te ajudar?\n\n1️⃣  Ver cardápio\n2️⃣  Status do meu pedido\n3️⃣  Falar com atendente\n\n_Digite o número da opção._`;
}

/** Envia menu como botões interativos (fallback após 2 inputs desconhecidos) */
async function sendInteractiveMenuFallback(phoneE164: string, companyName: string): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        `Como posso te ajudar no *${companyName}*?`,
        [
            { id: "1", title: "Ver cardápio" },
            { id: "2", title: "Status do pedido" },
            { id: "3", title: "Falar com atendente" },
        ]
    );
}

/**
 * Fallback inteligente: quando OrderParserService retorna confiança baixa (< 0.3)
 * e o usuário NÃO está em step de texto livre.
 * 1ª vez: pergunta educadamente se quer adicionar produto ou falar com atendente.
 * 2ª vez: envia List Message com categorias do ERP.
 */
async function handleLowConfidenceFallback(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<boolean> {
    const count = ((session.context.consecutive_unknown_count as number) ?? 0) + 1;
    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, consecutive_unknown_count: count },
    });

    if (count === 1) {
        await reply(
            phoneE164,
            `Não consegui entender muito bem. 😅\n\n` +
            `Você gostaria de *adicionar um produto* ao pedido ou *falar com um atendente*?\n\n` +
            `Digite o nome do produto ou escolha uma opção abaixo:`
        );
        await sendInteractiveButtons(phoneE164, "Como posso ajudar?", [
            { id: "1", title: "Ver cardápio" },
            { id: "2", title: "Status do pedido" },
            { id: "3", title: "Falar com atendente" },
        ]);
        return true;
    }

    const categories = await getCategories(admin, companyId);
    if (categories.length > 0) {
        await saveSession(admin, threadId, companyId, {
            step: "catalog_categories",
            context: { ...session.context, categories, consecutive_unknown_count: 0 },
        });
        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria para ver os produtos:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
    } else {
        await reply(phoneE164, `Não encontrei categorias no momento. Deseja *falar com um atendente*?`);
        await sendInteractiveButtons(phoneE164, "Opções:", [
            { id: "1", title: "Ver cardápio" },
            { id: "3", title: "Falar com atendente" },
        ]);
    }
    return true;
}

/** Incrementa consecutive_unknown_count; se >= 2, envia menu interativo e retorna true */
async function handleUnknownInputAndMaybeSendMenu(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<boolean> {
    const count = ((session.context.consecutive_unknown_count as number) ?? 0) + 1;
    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, consecutive_unknown_count: count },
    });
    if (count >= 2) {
        await sendInteractiveMenuFallback(phoneE164, companyName);
        return true;
    }
    return false;
}

/** Menu principal (1, 2, 3) — usado apenas quando busca por produto falha */
function buildMainMenu(companyName: string, customerName?: string | null): string {
    const hasName = !!(customerName && customerName.trim().length > 0);
    const hello = hasName
        ? `Olá, *${customerName.trim()}*! Seja bem-vindo(a) novamente ao *${companyName}* 🍺\n\n`
        : `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\n`;

    return hello + getMenuOptionsOnly();
}

/** Saudação inicial — prioriza pedido direto, não pede nome no início */
function buildWelcomeGreeting(companyName: string, customerName?: string | null): string {
    const hasName = !!(customerName && customerName.trim().length > 0);
    if (hasName) {
        return `Olá, *${customerName.trim()}*! O que manda pra hoje? 🍺\n\n_Digite o que deseja ou o endereço de entrega._`;
    }
    return `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nO que manda pra hoje? _Digite o que deseja._`;
}

async function handleMainMenu(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    settings: Record<string, unknown>,
    input: string,
    session: Session,
    profileName?: string | null
): Promise<void> {
    // Primeira mensagem → prioriza pedido/endereço; só manda saudação se input curto ou notfound
    if (session.step === "welcome") {
        if (!isWithinBusinessHours(settings)) {
            const msg = (settings?.closed_message as string) ??
                "Olá! No momento estamos fechados. Volte em breve. 😊";
            await reply(phoneE164, msg);
            return;
        }

        const phoneClean = phoneE164.replace(/\D/g, "");
        const { data: customer } = await admin
            .from("customers")
            .select("id, name")
            .eq("company_id", companyId)
            .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
            .limit(1)
            .maybeSingle();

        const looksLikeProduct = /\s/.test(input) || /\d/.test(input);
        if (looksLikeProduct && input.length > 2) {
            const ftEarly = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
            await saveSession(admin, threadId, companyId, { step: "main_menu" });
            if (ftEarly === "handled") return;
            if (ftEarly === "notfound") {
                await reply(phoneE164, `Não encontrei _"${input}"_.\n\n${getMenuOptionsOnly()}`);
                return;
            }
        }

        await saveSession(admin, threadId, companyId, { step: "main_menu" });
        await reply(phoneE164, buildWelcomeGreeting(companyName, customer?.name));
        return;
    }

    // ── Busca livre antecipada: se a mensagem parece um pedido de produto, tenta buscar
    //    antes de validar os atalhos 1/2/3 para não perder a intenção do cliente.
    //    Critério: mais de uma palavra OU contém dígito junto com texto (ex: "3 skol")
    const looksLikeProduct = /\s/.test(input) || /\d/.test(input);
    if (looksLikeProduct && input.length > 2) {
        const ftEarly = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
        if (ftEarly === "handled") return;
        // "notfound" ou "skip" → continua o fluxo normal abaixo
    }

    // Opção 1: Ver cardápio
    if (input === "1" || matchesAny(input, ["cardapio", "produtos", "bebidas", "ver"])) {
        const categories = await getCategories(admin, companyId);

        if (!categories.length) {
            await reply(phoneE164, "Ops! Nenhuma categoria cadastrada ainda. Tente mais tarde. 😅");
            return;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories, consecutive_unknown_count: 0 },
        });

        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    // Opção 2: Status do pedido
    if (input === "2" || matchesAny(input, ["status", "pedido", "onde", "acompanhar"])) {
        await saveSession(admin, threadId, companyId, { context: { ...session.context, consecutive_unknown_count: 0 } });
        const customer = await getOrCreateCustomer(admin, companyId, phoneE164, profileName);

        if (!customer) {
            await reply(phoneE164, "Não encontrei cadastro para o seu número. 😅");
            return;
        }

        const { data: lastOrder } = await admin
            .from("orders")
            .select("id, status, created_at, total_amount")
            .eq("company_id", companyId)
            .eq("customer_id", customer.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastOrder) {
            await reply(phoneE164,
                "Você ainda não fez nenhum pedido por aqui. 😊\n" +
                "Digite *1* para ver o cardápio!"
            );
            return;
        }

        const statusLabels: Record<string, string> = {
            new:       "✅ Recebido",
            confirmed: "✅ Confirmado",
            preparing: "🔥 Em preparo",
            delivering:"🛵 Saiu para entrega",
            delivered: "📦 Entregue",
            finalized: "✅ Finalizado",
            canceled:  "❌ Cancelado",
        };

        const label = statusLabels[lastOrder.status] ?? lastOrder.status;
        const date  = new Date(lastOrder.created_at).toLocaleString("pt-BR");

        await reply(
            phoneE164,
            `*Seu último pedido:*\n\n` +
            `📋 Status: ${label}\n` +
            `💰 Total: ${formatCurrency(lastOrder.total_amount)}\n` +
            `📅 Data: ${date}\n\n` +
            `_Digite *1* para fazer um novo pedido._`
        );
        return;
    }

    // Opção 3: Falar com atendente
    if (input === "3" || matchesAny(input, ["atendente", "humano"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // Texto livre → tenta buscar produto antes de repetir menu
    const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
    if (ftResult === "handled") return;

    // Fallback: após 2 inputs desconhecidos, envia menu interativo (botões WhatsApp)
    const sentMenu = await handleUnknownInputAndMaybeSendMenu(admin, threadId, companyId, phoneE164, companyName, session);
    if (sentMenu) return;

    if (ftResult === "notfound") {
        await reply(phoneE164, `Não encontrei _"${input}"_.\n\n${getMenuOptionsOnly()}`);
        return;
    }

    // Input inválido (skip ou outro) → repete menu
    await reply(phoneE164, buildMainMenu(companyName));
}

// ─── CATALOG_CATEGORIES ───────────────────────────────────────────────────────

async function handleCatalogCategories(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const categories = (session.context.categories as Category[]) ?? [];

    const num = parseInt(input, 10);
    let selected: Category | null = null;

    if (!isNaN(num) && num >= 1 && num <= categories.length) {
        selected = categories[num - 1];
    } else {
        const lower = normalize(input);
        selected = categories.find((c) => normalize(c.name).includes(lower)) ?? null;
    }

    // ── Busca livre por texto ─────────────────────────────────────────────────
    if (!selected && input.length >= 2) {
        const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
        if (ftResult === "handled") return;
        if (ftResult === "notfound") {
            await sendListMessage(
                phoneE164,
                `Não encontrei _"${input}"_ 😅 Escolha uma categoria:`,
                "Ver categorias",
                categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
                "Categorias"
            );
            return;
        }
    }

    if (!selected) {
        await sendListMessage(
            phoneE164,
            "Não entendi. Escolha uma categoria ou *digite o nome do produto*:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    const variants = await getVariantsByCategory(admin, companyId, selected.id);

    if (!variants.length) {
        await reply(
            phoneE164,
            `Nenhum produto disponível em *${selected.name}* no momento.\n` +
            `Digite *menu* para voltar.`
        );
        return;
    }

    await saveSession(admin, threadId, companyId, {
        step:    "catalog_products",
        context: { ...session.context, variants, category_id: selected.id, category_name: selected.name, brand_name: selected.name },
    });

    await sendVariantsList(phoneE164, variants, selected.name, selected.name);
}

async function sendBrandsList(
    phoneE164: string,
    brands: Brand[],
    categoryName: string
): Promise<void> {
    await sendListMessage(
        phoneE164,
        `*${categoryName}* 🍺\n_Escolha uma marca:_`,
        "Ver marcas",
        brands.map((b, i) => ({ id: String(i + 1), title: truncateTitle(b.name) })),
        "Marcas"
    );
}

async function sendVariantsList(
    phoneE164: string,
    variants: VariantRow[],
    catName: string,
    brandName: string
): Promise<void> {
    const unitRows = variants.map((v) => ({
        id:          v.id,
        title:       truncateTitle(`${buildProductDisplayName(v)} - ${formatCurrency(v.unitPrice)}`),
        description: v.details ?? undefined,
    }));

    const caseVariants = variants.filter((v) => v.hasCase && v.casePrice);

    const sections: Array<{ title: string; rows: typeof unitRows }> = [
        { title: "Unitário", rows: unitRows },
    ];

    if (caseVariants.length > 0) {
        sections.push({
            title: "Caixa com:",
            rows:  caseVariants.map((v) => ({
                id:          `${v.id}_case`,
                title:       truncateTitle(`${v.caseQty}un - ${buildProductDisplayName(v, true)}`),
                description: `${v.details ? v.details + " - " : ""}${formatCurrency(v.casePrice ?? 0)}`,
            })),
        });
    }

    await sendListMessageSections(
        phoneE164,
        `*${brandName}* — ${catName} 🍺\n_Escolha um produto:_`,
        "Ver produtos",
        sections
    );
}

// ─── DB: Zonas de entrega ─────────────────────────────────────────────────────

interface DeliveryZone { id: string; label: string; fee: number; }

/**
 * Busca zona de entrega pelo nome do bairro usando .ilike() com % (fuzzy).
 * Ex: "São Mateus" → %sao mateus%
 */
async function findDeliveryZone(
    admin: SupabaseClient,
    companyId: string,
    neighborhood: string
): Promise<DeliveryZone | null> {
    const normalized = normalize(neighborhood);
    const { data } = await admin
        .from("delivery_zones")
        .select("id, label, fee")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .ilike("label", `%${normalized}%`)
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return { id: data.id, label: data.label, fee: Number(data.fee) };
}

/** Lista todas as zonas de entrega ativas (para fallback). */
async function listDeliveryZones(
    admin: SupabaseClient,
    companyId: string
): Promise<DeliveryZone[]> {
    const { data } = await admin
        .from("delivery_zones")
        .select("id, label, fee")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("fee", { ascending: true })
        .limit(20);

    return (data ?? []).map((z) => ({ id: z.id, label: z.label, fee: Number(z.fee) }));
}

// ─── CATALOG_BRANDS ────────────────────────────────────────────────────────────

async function handleCatalogBrands(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const brands     = (session.context.brands      as Brand[])  ?? [];
    const catName    = (session.context.category_name as string) ?? "Produtos";
    const categoryId = (session.context.category_id  as string)  ?? "";

    // Mais produtos → volta ao início do catálogo
    if (input === "mais_produtos" || matchesAny(input, ["mais produtos"])) {
        const categories = (session.context.categories as Category[]) ?? await getCategories(admin, companyId);
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories },
        });
        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    const num = parseInt(input, 10);
    let selected: Brand | null = null;

    if (!isNaN(num) && num >= 1 && num <= brands.length) {
        selected = brands[num - 1];
    } else {
        const lower = normalize(input);
        selected = brands.find((b) => normalize(b.name).includes(lower)) ?? null;
    }

    if (!selected) {
        // Tenta busca livre antes de repetir lista de marcas
        if (input.length >= 2) {
            const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
            if (ftResult === "handled") return;
        }
        await sendBrandsList(phoneE164, brands, catName);
        return;
    }

    const variants = await getVariantsByBrandAndCategory(admin, companyId, selected.id, categoryId);

    if (!variants.length) {
        await reply(
            phoneE164,
            `Nenhum produto disponível para *${selected.name}* no momento.\n` +
            `Digite *menu* para voltar.`
        );
        return;
    }

    await saveSession(admin, threadId, companyId, {
        step:    "catalog_products",
        context: { ...session.context, variants, brand_name: selected.name },
    });

    await sendVariantsList(phoneE164, variants, catName, selected.name);
}

// ─── CATALOG_PRODUCTS ─────────────────────────────────────────────────────────

async function handleCatalogProducts(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const variants   = (session.context.variants    as VariantRow[]) ?? [];
    const catName    = (session.context.category_name as string)     ?? "Produtos";
    const brandName  = (session.context.brand_name   as string)      ?? "";

    // ── Mais produtos → volta ao início do catálogo ───────────────────────────
    if (input === "mais_produtos" || matchesAny(input, ["mais produtos"])) {
        const categories = (session.context.categories as Category[]) ?? await getCategories(admin, companyId);
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories },
        });
        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    // ── Ver mais resultados de busca (lista numerada completa) ───────────────
    if (input === "ver_mais") {
        if (variants.length > 0) {
            const listText = formatNumberedList(variants);
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, search_numbered: true },
            });
            await reply(
                phoneE164,
                `🔍 Todas as ${variants.length} opções encontradas:\n\n${listText}\n\nDigite o *número* da opção (ex: *2*) ou vários separados por vírgula (ex: *1,3*).`
            );
        } else {
            await reply(phoneE164, "Não há mais opções. Digite o nome do produto para buscar novamente.");
        }
        return;
    }

    // ── Aguardando confirmação do bairro (para calcular taxa de entrega) ─────
    if (session.context.awaiting_neighborhood) {
        const zone = await findDeliveryZone(admin, companyId, input);
        if (zone) {
            const address    = (session.context.delivery_address as string) ?? "";
            const cartSum    = cartTotal(session.cart);
            const totalFinal = cartSum + zone.fee;
            await saveSession(admin, threadId, companyId, {
                context: {
                    ...session.context,
                    awaiting_neighborhood: false,
                    delivery_fee:          zone.fee,
                    delivery_zone_id:      zone.id,
                    // Append neighborhood to address if not already there
                    delivery_address: address.includes(zone.label) ? address : `${address} - ${zone.label}`,
                },
            });
            await sendInteractiveButtons(
                phoneE164,
                `🛵 Entrega para *${zone.label}*: *${formatCurrency(zone.fee)}*\n` +
                `💰 Total com entrega: *${formatCurrency(totalFinal)}*\n\n` +
                `Algo mais ou deseja finalizar?`,
                [
                    { id: "mais_produtos", title: "Mais produtos"    },
                    { id: "finalizar",     title: "Finalizar pedido" },
                ]
            );
        } else {
            // Bairro não encontrado → lista as zonas disponíveis
            const zones    = await listDeliveryZones(admin, companyId);
            const zoneList = zones.length
                ? zones.map((z) => `• ${z.label} — ${formatCurrency(z.fee)}`).join("\n")
                : "_Nenhuma zona cadastrada ainda._";
            await reply(
                phoneE164,
                `⚠️ Não atendemos *${input}* ainda.\nNossos bairros de entrega:\n\n${zoneList}\n\n_Qual é o seu bairro?_`
            );
        }
        return;
    }

    // ── Seleção numérica (quando vem de lista numerada em texto) ──────────────
    const isNumberedSearch = Boolean(session.context.search_numbered);
    const looksNumeric     = /^[\d,\s]+$/.test(input.trim()) && /\d/.test(input);

    if (isNumberedSearch && looksNumeric && !session.context.pending_variant) {
        // Parse: "2" → [1]   "1,3" → [0,2]   "1 3 5" → [0,2,4]
        const indices = input
            .split(/[,\s]+/)
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((i) => !isNaN(i) && i >= 0 && i < variants.length);

        console.log("[catalog_products] seleção numérica:", input, "→ índices:", indices);

        if (!indices.length) {
            const listText = formatNumberedList(variants.slice(0, 5));
            await reply(phoneE164, `Número inválido. Escolha entre 1 e ${Math.min(variants.length, 5)}:\n\n${listText}`);
            return;
        }

        if (indices.length === 1) {
            // Seleção simples → pergunta quantidade
            const v       = variants[indices[0]];
            const label   = `*${buildProductDisplayName(v)}* — ${formatCurrency(v.unitPrice)}`;
            const caseInfo = v.hasCase && v.casePrice
                ? `\n_Também disponível em caixa com ${v.caseQty}un por ${formatCurrency(v.casePrice)}._`
                : "";
            await saveSession(admin, threadId, companyId, {
                context: {
                    ...session.context,
                    search_numbered: false,
                    pending_variant: v,
                    pending_is_case: false,
                },
            });
            await reply(phoneE164, `${label}${caseInfo}\n\nQuantas unidades deseja?`);
            return;
        }

        // Seleção múltipla → adiciona todos com qty = 1 e exibe resumo
        const newCart    = [...session.cart];
        const addedLines: string[] = [];

        for (const idx of indices) {
            const v        = variants[idx];
            const itemName = buildProductDisplayName(v);
            const existing = newCart.findIndex((c) => c.variantId === v.id && !c.isCase);
            if (existing >= 0) {
                newCart[existing] = { ...newCart[existing], qty: newCart[existing].qty + 1 };
            } else {
                newCart.push({ variantId: v.id, productId: v.productId, name: itemName, price: v.unitPrice, qty: 1, isCase: false });
            }
            addedLines.push(`✅ 1x *${itemName}* — ${formatCurrency(v.unitPrice)}`);
        }

        await saveSession(admin, threadId, companyId, {
            step: "catalog_products",
            cart: newCart,
            context: {
                ...session.context,
                search_numbered: false,
                pending_variant: null,
                pending_is_case: null,
            },
        });

        await sendInteractiveButtons(
            phoneE164,
            `${addedLines.join("\n")}\n\n${formatCart(newCart)}\n\n_Cada item adicionado com 1 unidade._`,
            [
                { id: "mais_produtos", title: "Mais produtos" },
                { id: "ver_carrinho",  title: "Ver carrinho"  },
                { id: "finalizar",     title: "Finalizar pedido" },
            ]
        );
        return;
    }

    // ── Navegar para carrinho ou finalizar ────────────────────────────────────
    if (input === "ver_carrinho" || matchesAny(input, ["carrinho", "ver carrinho"])) {
        await goToCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    if (input === "finalizar" || matchesAny(input, ["finalizar", "fechar", "checkout"])) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Escolha um produto primeiro.");
            return;
        }
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    // ── Aguardando quantidade (ou opção+quantidade quando unit_case_choice) ─────
    const pendingVariant  = session.context.pending_variant as VariantRow | undefined;
    const pendingIsCase   = session.context.pending_is_case as boolean   | undefined;
    const unitCaseChoice  = session.context.unit_case_choice as boolean  | undefined;

    if (pendingVariant) {
        let opt = 1;
        let qty = 1;
        if (unitCaseChoice) {
            const parts = input.trim().split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                const o = parseInt(parts[0], 10);
                const q = parseInt(parts[1], 10);
                if (!isNaN(o) && (o === 1 || o === 2) && !isNaN(q) && q >= 1 && q <= 99) {
                    opt = o;
                    qty = q;
                } else {
                    await reply(phoneE164, "Digite a opção (1 ou 2) e a quantidade, ex: *1 3* ou *2 1*.");
                    return;
                }
            } else if (parts.length === 1) {
                qty = parseInt(parts[0], 10);
                if (isNaN(qty) || qty < 1 || qty > 99) {
                    await reply(phoneE164, "Digite uma quantidade válida (1 a 99) ou opção e quantidade (ex: *2 1*).");
                    return;
                }
            } else {
                await reply(phoneE164, "Digite a opção e quantidade, ex: *1 3* ou *2 1*.");
                return;
            }
        } else {
            qty = parseInt(input, 10);
            if (isNaN(qty) || qty < 1 || qty > 99) {
                await reply(phoneE164, "Digite uma quantidade válida (1 a 99).");
                return;
            }
        }

        const isCase = unitCaseChoice ? opt === 2 : Boolean(pendingIsCase);
        const price  = isCase ? (pendingVariant.casePrice ?? pendingVariant.unitPrice) : pendingVariant.unitPrice;
        const name   = buildProductDisplayName(pendingVariant, isCase);

        const newCart     = [...session.cart];
        const existingIdx = newCart.findIndex(
            (i) => i.variantId === pendingVariant.id && Boolean(i.isCase) === isCase
        );

        if (existingIdx >= 0) {
            newCart[existingIdx] = { ...newCart[existingIdx], qty: newCart[existingIdx].qty + qty };
        } else {
            newCart.push({
                variantId: isCase ? (pendingVariant.caseVariantId ?? pendingVariant.id) : pendingVariant.id,
                productId: pendingVariant.productId,
                name,
                price,
                qty,
                isCase,
                caseQty: isCase ? (pendingVariant.caseQty ?? undefined) : undefined,
            });
        }

        await saveSession(admin, threadId, companyId, {
            step: "catalog_products",
            cart: newCart,
            context: { ...session.context, pending_variant: null, pending_is_case: null, unit_case_choice: false },
        });

        await sendInteractiveButtons(
            phoneE164,
            `✅ *${qty}x ${name}* adicionado!\n\n${formatCart(newCart)}`,
            [
                { id: "mais_produtos", title: "Mais produtos" },
                { id: "ver_carrinho",  title: "Ver carrinho" },
                { id: "finalizar",     title: "Finalizar pedido" },
            ]
        );
        return;
    }

    // ── Seleção de item (unitário ou caixa) ───────────────────────────────────
    let selectedVariant: VariantRow | undefined;
    let isCase = false;

    if (input.endsWith("_case")) {
        const varId = input.slice(0, -5);
        selectedVariant = variants.find((v) => v.id === varId);
        isCase = true;
    } else {
        selectedVariant = variants.find((v) => v.id === input);
        isCase = false;
    }

    if (!selectedVariant) {
        // Fallback: se estava em modo numerado, reexibe a lista numerada
        if (isNumberedSearch && variants.length > 0) {
            const listText = formatNumberedList(variants.slice(0, 5));
            await reply(phoneE164, `Opção inválida. Escolha um número da lista:\n\n${listText}`);
        } else {
            await sendVariantsList(phoneE164, variants, catName, brandName);
        }
        return;
    }

    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, pending_variant: selectedVariant, pending_is_case: isCase },
    });

    const selName  = buildProductDisplayName(selectedVariant, isCase);
    const label    = isCase
        ? `*${selName} — Caixa com ${selectedVariant.caseQty}un* (${formatCurrency(selectedVariant.casePrice ?? 0)})`
        : `*${selName}* (${formatCurrency(selectedVariant.unitPrice)})`;

    await reply(phoneE164, `${label}\n\nQuantas unidades?`);
}

// ─── CART ─────────────────────────────────────────────────────────────────────

async function handleCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
): Promise<void> {
    if (matchesAny(input, ["finalizar", "fechar", "checkout", "confirmar"])) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Digite *1* para ver o cardápio.");
            return;
        }
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    // "Mais produtos" → volta ao catálogo sem limpar o carrinho
    if (input === "mais_produtos" || matchesAny(input, ["mais produtos", "adicionar", "continuar"])) {
        const categories = (session.context.categories as Category[]) ?? await getCategories(admin, companyId);
        if (!categories.length) {
            await reply(phoneE164, "Nenhuma categoria disponível. Tente novamente.");
            return;
        }
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories },
            // cart preservado
        });
        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    if (matchesAny(input, ["limpar", "esvaziar"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await reply(phoneE164, "Carrinho esvaziado.\n\n" + buildMainMenu(companyName));
        return;
    }

    // "remover 2", "tirar 1"
    const removeMatch = normalize(input).match(/^(remover|tirar|deletar)\s+(\d+)$/);
    if (removeMatch) {
        const idx = parseInt(removeMatch[2], 10) - 1;
        if (idx >= 0 && idx < session.cart.length) {
            const removed = session.cart[idx];
            const newCart = session.cart.filter((_, i) => i !== idx);
            await saveSession(admin, threadId, companyId, { cart: newCart });
            await reply(
                phoneE164,
                `🗑️ *${removed.name}* removido.\n\n${formatCart(newCart)}\n\n` +
                `_Digite *finalizar* para fechar o pedido ou *menu* para continuar comprando._`
            );
            return;
        }
    }

    // Texto livre → tenta adicionar produto diretamente
    const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
    if (ftResult === "handled") return;

    await goToCart(admin, companyId, threadId, phoneE164, session);
}

async function goToCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    if (!session.cart.length) {
        await saveSession(admin, threadId, companyId, { step: "main_menu" });
        await reply(phoneE164, "Carrinho vazio. Digite *1* para ver o cardápio.");
        return;
    }

    await saveSession(admin, threadId, companyId, { step: "cart" });

    const hasCheckoutData = !!(session.context.delivery_address && session.context.payment_method);
    await reply(
        phoneE164,
        `🛒 *Seu carrinho:*\n\n${formatCart(session.cart)}\n\n` +
        `Digite *finalizar* para ${hasCheckoutData ? "confirmar o pedido" : "fechar o pedido"}\n` +
        `Digite *mais produtos* para continuar comprando\n` +
        `Digite *remover N* para tirar o item N`
    );
}

/**
 * Se o contexto já tem endereço e pagamento → checkout_confirm.
 * Se tem endereço mas não pagamento → checkout_payment (não pede endereço de novo).
 * Se não tem endereço → checkout_address.
 */
async function goToCheckoutFromCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    const address = session.context.delivery_address as string | undefined;
    const payment = session.context.payment_method   as string | undefined;

    if (address && payment) {
        await saveSession(admin, threadId, companyId, { step: "checkout_confirm" });
        await sendOrderSummary(phoneE164, session);
    } else if (address) {
        const customer = await getOrCreateCustomer(admin, companyId, phoneE164);
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_payment",
            customer_id: customer?.id ?? session.customer_id,
            context:     session.context,
        });
        await sendPaymentButtons(phoneE164);
    } else {
        await goToCheckoutAddress(admin, companyId, threadId, phoneE164, session);
    }
}

// ─── CHECKOUT_ADDRESS ─────────────────────────────────────────────────────────

async function goToCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    const customer   = await getOrCreateCustomer(admin, companyId, phoneE164);
    const customerId = customer?.id ?? null;
    const saved      = customer?.address ?? null;

    if (saved) {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: saved },
        });
        await reply(
            phoneE164,
            `📍 *Endereço de entrega cadastrado:*\n${saved}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
    } else {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: null, awaiting_address: true },
        });
        await reply(
            phoneE164,
            `📍 Qual é o seu *endereço de entrega*?\n\n` +
            `_Ex: Rua das Flores, 123, Bairro Centro_`
        );
    }
}

async function handleAwaitingAddressNumber(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const addressDraft = (session.context.address_draft as string) ?? "";
    if (!addressDraft) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", context: { ...session.context, address_draft: undefined } });
        await reply(phoneE164, "Não encontrei o endereço anterior. Pode informar novamente? (Ex: Rua das Flores, 123)");
        return;
    }

    const numMatch = input.trim().match(/(\d{1,5})/);
    const number = numMatch ? numMatch[1] : input.trim();
    if (!number) {
        await reply(phoneE164, "Por favor, digite apenas o *número* do endereço (ex: 120).");
        return;
    }

    const combinedAddress = addressDraft.includes(number) ? addressDraft : `${addressDraft}, ${number}`.replace(/\s*,\s*,\s*/, ", ");
    const parser = getOrderParserService();
    const parsedAddr = await parser.validateAddress(combinedAddress);

    if (parsedAddr) {
        const neighborhood = parsedAddr.neighborhood ?? null;

        // Sem bairro → pede bairro antes de ir ao pagamento
        if (!neighborhood) {
            const finalAddr = parsedAddr.formatted ?? combinedAddress;
            await saveSession(admin, threadId, companyId, {
                step: "awaiting_address_neighborhood",
                context: {
                    ...session.context,
                    address_draft:    finalAddr,
                    address_validation_error: undefined,
                    delivery_address_structured: {
                        rua:       parsedAddr.street      ?? "",
                        numero:    parsedAddr.houseNumber  ?? null,
                        bairro:    "",
                        formatted: finalAddr,
                        placeId:   parsedAddr.placeId      ?? "",
                    },
                },
            });
            await reply(
                phoneE164,
                `📍 Endereço: *${finalAddr}*\n\n` +
                `Para calcular o frete, qual é o seu *bairro*? (ex: Centro, Residencial Bela Vista)`
            );
            return;
        }

        await commitAddress(admin, companyId, threadId, phoneE164, session, parsedAddr.formatted ?? combinedAddress, neighborhood, parsedAddr);
        return;
    }

    await reply(phoneE164, "Não consegui validar o endereço. Pode enviar o endereço completo? (Ex: Rua das Flores, 123, Centro)");
}

async function handleCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session,
    _profileName?: string | null
): Promise<void> {
    const savedAddress   = session.context.saved_address   as string | null;
    const awaitingAddress = session.context.awaiting_address as boolean | undefined;

    // Temos endereço salvo e aguardamos "1" ou "2"
    if (savedAddress && !awaitingAddress) {
        if (input === "1") {
            await saveSession(admin, threadId, companyId, {
                step:        "checkout_payment",
                customer_id: session.customer_id,
                context:     { ...session.context, delivery_address: savedAddress },
            });
            await sendPaymentButtons(phoneE164);
            return;
        }
        if (input === "2") {
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, saved_address: null, awaiting_address: true },
            });
            await reply(phoneE164, `📍 Informe o novo endereço de entrega:\n\n_Ex: Rua das Flores, 123_`);
            return;
        }
        // Input inválido → repete a pergunta
        await reply(
            phoneE164,
            `📍 *Endereço cadastrado:*\n${savedAddress}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
        return;
    }

    // Aguardando digitação do endereço
    if (input.length < 5) {
        await reply(phoneE164, "Por favor, informe o endereço completo (rua, número e bairro).");
        return;
    }

    // 1) Exige número no endereço
    if (!/\d/.test(input)) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_address_number",
            context: { ...session.context, address_draft: input, saved_address: null, awaiting_address: false },
        });
        await reply(phoneE164, `📍 Endereço parcial: *${input}*\n\nQual é o *número* do endereço? (ex: 120, 456)`);
        return;
    }

    // 2) Valida com Google
    const parser = getOrderParserService();
    const parsedAddr = await parser.validateAddress(input);
    const finalAddr  = parsedAddr?.formatted ?? input;
    const neighborhood = parsedAddr?.neighborhood ?? null;

    // 3) Google não retornou bairro → pede
    if (!neighborhood) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_address_neighborhood",
            context: {
                ...session.context,
                address_draft:    finalAddr,
                saved_address:    null,
                awaiting_address: false,
                delivery_address_structured: parsedAddr ? {
                    rua:       parsedAddr.street    ?? "",
                    numero:    parsedAddr.houseNumber ?? null,
                    bairro:    "",
                    formatted: finalAddr,
                    placeId:   parsedAddr.placeId   ?? "",
                } : null,
            },
        });
        await reply(
            phoneE164,
            `📍 Endereço: *${finalAddr}*\n\n` +
            `Para calcular o frete, qual é o seu *bairro*? (ex: Centro, Residencial Bela Vista)`
        );
        return;
    }

    // 4) Bairro confirmado → salva e vai para pagamento
    await commitAddress(admin, companyId, threadId, phoneE164, session, finalAddr, neighborhood, parsedAddr ?? undefined);
}

/**
 * Persiste endereço validado (Google + bairro resolvido), atualiza customer e vai para pagamento.
 */
async function commitAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session,
    finalAddr: string,
    neighborhood: string,
    parsedAddr?: { street?: string; houseNumber?: string; placeId?: string; formatted?: string }
): Promise<void> {
    const zone = await findDeliveryZone(admin, companyId, neighborhood);

    if (session.customer_id) {
        await admin.from("customers")
            .update({ address: finalAddr, neighborhood })
            .eq("id", session.customer_id);

        const { data: existingAddr } = await admin
            .from("enderecos_cliente")
            .select("id")
            .eq("customer_id", session.customer_id)
            .eq("apelido", "Chatbot")
            .maybeSingle();

        if (existingAddr?.id) {
            await admin.from("enderecos_cliente").update({
                logradouro:   finalAddr,
                bairro:       neighborhood,
                is_principal: true,
            }).eq("id", existingAddr.id);
        } else {
            await admin.from("enderecos_cliente").insert({
                company_id:   companyId,
                customer_id:  session.customer_id,
                apelido:      "Chatbot",
                logradouro:   finalAddr,
                bairro:       neighborhood,
                is_principal: true,
            });
        }
    }

    await saveSession(admin, threadId, companyId, {
        step:        "checkout_payment",
        customer_id: session.customer_id,
        context: {
            ...session.context,
            delivery_address:    finalAddr,
            delivery_neighborhood: neighborhood,
            delivery_fee:        zone?.fee ?? null,
            delivery_zone_id:    zone?.id  ?? null,
            delivery_address_structured: parsedAddr ? {
                rua:       parsedAddr.street      ?? "",
                numero:    parsedAddr.houseNumber  ?? null,
                bairro:    neighborhood,
                formatted: finalAddr,
                placeId:   parsedAddr.placeId      ?? "",
            } : null,
            address_draft:         undefined,
            address_validation_error: undefined,
            saved_address:         null,
            awaiting_address:      false,
        },
    });

    const feeText = zone ? `\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*` : "";
    await reply(phoneE164, `📍 Endereço confirmado: *${finalAddr}* — ${neighborhood}${feeText}`);
    await sendPaymentButtons(phoneE164);
}

// ─── AWAITING_ADDRESS_NEIGHBORHOOD ────────────────────────────────────────────

async function handleAwaitingAddressNeighborhood(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const addressDraft = (session.context.address_draft as string) ?? "";
    if (!addressDraft) {
        await saveSession(admin, threadId, companyId, { step: "checkout_address", context: { ...session.context, awaiting_address: true } });
        await reply(phoneE164, "Não encontrei o endereço anterior. Pode informar novamente? (Ex: Rua das Flores, 123)");
        return;
    }

    const neighborhood = input.trim();
    if (neighborhood.length < 2) {
        await reply(phoneE164, "Por favor, informe o nome do bairro (ex: Centro, Jardim Primavera).");
        return;
    }

    // Combina endereço + bairro e valida novamente para obter formatted correto
    const parser     = getOrderParserService();
    const combined   = `${addressDraft}, ${neighborhood}`;
    const parsedAddr = await parser.validateAddress(combined);
    const finalAddr  = parsedAddr?.formatted ?? combined;
    const resolvedNeighborhood = parsedAddr?.neighborhood ?? neighborhood;

    await commitAddress(admin, companyId, threadId, phoneE164, session, finalAddr, resolvedNeighborhood, parsedAddr ?? undefined);
}

// ─── CHECKOUT_PAYMENT ─────────────────────────────────────────────────────────

async function sendPaymentButtons(phoneE164: string): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        "💳 Como deseja pagar?",
        [
            { id: "card", title: "Cartão" },
            { id: "pix",  title: "PIX" },
            { id: "cash", title: "Dinheiro" },
        ]
    );
}

/** Verifica se o endereço tem número da casa; se não, botão Confirmar não deve aparecer */
function isAddressComplete(session: Session): boolean {
    const structured = session.context.delivery_address_structured as { numero?: string } | null;
    if (structured?.numero && String(structured.numero).trim().length > 0) return true;
    if (session.context.address_draft && session.context.address_validation_error) return false;
    const addr = (session.context.delivery_address as string) ?? "";
    return /\d{1,5}/.test(addr);
}

/**
 * Envia resumo do pedido no WhatsApp com itens (preços ERP), endereço validado e total c/ frete.
 * 3 botões: Confirmar Pedido, Alterar Itens, Mudar Endereço.
 * Se faltar número do endereço, pergunta pela informação e não exibe botão Confirmar.
 */
async function sendOrderSummary(
    phoneE164: string,
    session: Session
): Promise<void> {
    const cart = session.cart;
    const address = (session.context.delivery_address as string) ?? "—";
    const paymentMethod = (session.context.payment_method as string) ?? "—";
    const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
    const paymentLabel = pmLabels[paymentMethod] ?? paymentMethod;
    const changeFor = (session.context.change_for as number | null) ?? null;
    const deliveryFee = (session.context.delivery_fee as number | null) ?? 0;

    const changeText = changeFor ? `\n💵 Troco: ${formatCurrency(changeFor)}` : "";
    const feeText = deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}` : "";
    const productsTotal = cartTotal(cart);
    const grandTotal = productsTotal + deliveryFee;
    const grandText = deliveryFee > 0 ? `\n\n💰 *Total final: ${formatCurrency(grandTotal)}*` : "";

    const addressComplete = isAddressComplete(session);
    if (!addressComplete) {
        await reply(
            phoneE164,
            `📋 *Resumo do pedido:*\n\n${formatCart(cart)}${feeText}\n` +
            `📍 Endereço: ${address}\n\n` +
            `⚠️ Para confirmar, preciso do *número* do endereço. Qual é o número da casa?`
        );
        await sendInteractiveButtons(phoneE164, "Enquanto isso:", [
            { id: "change_items", title: "🔄 Alterar itens" },
            { id: "change_address", title: "📍 Mudar endereço" },
        ]);
        return;
    }

    await reply(
        phoneE164,
        `📋 *Resumo do pedido:*\n\n` +
        `${formatCart(cart)}\n` +
        `${feeText}\n` +
        `📍 Entrega: ${address}\n` +
        `💳 Pagamento: ${paymentLabel}${changeText}` +
        `${grandText}`
    );
    await sendInteractiveButtons(phoneE164, "Confirmar o pedido?", [
        { id: "confirmar", title: "✅ Confirmar pedido" },
        { id: "change_items", title: "🔄 Alterar itens" },
        { id: "change_address", title: "📍 Mudar endereço" },
    ]);
}

async function handleCheckoutPayment(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const address = (session.context.delivery_address as string) ?? "—";

    // ── Sub-step: aguardando valor do troco ───────────────────────────────────
    if (session.context.awaiting_change_for) {
        let changeFor: number | null = null;

        if (!matchesAny(input, ["nao", "não", "n", "sem troco"])) {
            const parsed = parseFloat(input.replace(",", ".").replace(/[^0-9.]/g, ""));
            if (isNaN(parsed) || parsed <= 0) {
                await reply(phoneE164, "Digite o valor do troco (ex: *50*) ou *não* se não precisar.");
                return;
            }
            changeFor = parsed;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "checkout_confirm",
            context: { ...session.context, change_for: changeFor, awaiting_change_for: false },
        });
        await sendOrderSummary(phoneE164, { ...session, context: { ...session.context, change_for: changeFor, awaiting_change_for: false } });
        return;
    }

    // ── Seleção de forma de pagamento ─────────────────────────────────────────
    // Valores aceitos pelo DB: "pix" | "cash" | "card"
    const paymentMap: Record<string, string> = {
        "1":       "card",
        "2":       "pix",
        "3":       "cash",
        "cartao":  "card",
        "cartão":  "card",
        "card":    "card",
        "credito": "card",
        "debito":  "card",
        "pix":     "pix",
        "dinheiro":"cash",
        "cash":    "cash",
    };

    let method = paymentMap[normalize(input)] ?? detectPaymentMethod(input);
    if (!method) {
        await sendPaymentButtons(phoneE164);
        return;
    }

    if (method === "cash") {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, payment_method: "cash", awaiting_change_for: true },
        });
        await reply(phoneE164, "💵 Troco para quanto?\n\nDigite o valor (ex: *50*) ou *não* se não precisar de troco.");
        return;
    }

    // pix ou card → vai direto para confirmação
    await saveSession(admin, threadId, companyId, {
        step:    "checkout_confirm",
        context: { ...session.context, payment_method: method },
    });
    await sendOrderSummary(phoneE164, { ...session, context: { ...session.context, payment_method: method } });
}

// ─── CHECKOUT_CONFIRM ─────────────────────────────────────────────────────────

async function handleCheckoutConfirm(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
): Promise<void> {
    const address       = (session.context.delivery_address as string) ?? "";
    const paymentMethod = (session.context.payment_method   as string) ?? "cash";
    const changeFor     = (session.context.change_for       as number | null) ?? null;

    console.log("[checkout_confirm] input:", input, "| customer_id:", session.customer_id,
        "| cart:", session.cart.length, "| address:", address,
        "| paymentMethod:", paymentMethod, "| changeFor:", changeFor);

    // "Mudar endereço" (ID change_address ou texto) → volta ao fluxo de endereço
    if (
        input === "change_address" ||
        matchesAny(input, ["alterar_endereco", "alterar endereco", "alterar endereço", "mudar endereço", "trocar endereço"])
    ) {
        await saveSession(admin, threadId, companyId, {
            step:    "checkout_address",
            context: { ...session.context, delivery_address: undefined, saved_address: null, awaiting_address: true },
        });
        await reply(
            phoneE164,
            `📍 Qual é o seu *novo endereço de entrega*?\n\n` +
            `_Ex: Rua das Flores, 123, Bairro Centro_`
        );
        return;
    }

    // "Alterar itens" (ID change_items ou texto) → vai para cart preservando endereço/pagamento
    if (
        input === "change_items" ||
        matchesAny(input, ["adicionar_produtos", "adicionar produtos"])
    ) {
        await saveSession(admin, threadId, companyId, {
            step:  "cart",
            context: session.context, // preserva endereço, pagamento, etc.
        });
        await reply(
            phoneE164,
            `Entendido! Pode digitar o que deseja *adicionar* ou *remover* do seu carrinho.\n\n` +
            `${formatCart(session.cart)}\n\n` +
            `_Digite o nome do produto para adicionar, *remover N* para tirar o item N, ou *finalizar* para fechar._`
        );
        return;
    }

    // Etapa: aguardando nome (pedido no final, antes de confirmar)
    if (session.context.awaiting_name_confirm) {
        const nameInput = input.trim();
        if (nameInput.length < 2) {
            await reply(phoneE164, "Por favor, digite seu nome completo.");
            return;
        }

        let customerId = session.customer_id;
        if (!customerId) {
            const recovered = await getOrCreateCustomer(admin, companyId, phoneE164);
            customerId = recovered?.id ?? null;
        }
        if (customerId) {
            await admin.from("customers").update({ name: nameInput }).eq("id", customerId);
        } else {
            const phoneClean = phoneE164.replace(/\D/g, "");
            const { data: inserted } = await admin.from("customers").insert({
                company_id: companyId,
                phone:      phoneE164,
                name:       nameInput,
            }).select("id").single();
            customerId = (inserted as any)?.id ?? null;
        }

        await saveSession(admin, threadId, companyId, {
            customer_id: customerId,
            context:     { ...session.context, awaiting_name_confirm: false },
        });

        // Após salvar nome, verificar maioridade
        const { data: custRow } = await admin
            .from("customers")
            .select("is_adult")
            .eq("id", customerId)
            .maybeSingle();

        if (!custRow?.is_adult) {
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, awaiting_name_confirm: false, awaiting_age_confirm: true },
            });
            await reply(
                phoneE164,
                "Para prosseguir com o pedido, confirme: você é *maior de 18 anos*? Responda *sim* ou *não*."
            );
            return;
        }
        // Nome salvo e já é maior → criar pedido diretamente (pula checagem de input)
        const feeForOrder = (session.context.delivery_fee as number | null) ?? 0;
        try {
            const orderId = await createOrder(admin, companyId, customerId!, session.cart, paymentMethod, address, changeFor, feeForOrder);
            const orderShort = orderId.replace(/-/g, "").slice(-8).toUpperCase();
            const cartSnapshot = [...session.cart];
            // Limpeza de sessão assim que o insert retornar sucesso: cart zerado, step em home
            await saveSession(admin, threadId, companyId, {
                step: "main_menu", cart: [], context: { last_order_id: orderId },
            });
            const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
            const paymentLine = paymentMethod === "cash"
                ? `💳 Pagamento: Dinheiro${changeFor ? ` (troco para ${formatCurrency(changeFor)})` : ""}`
                : `💳 Pagamento: ${pmLabels[paymentMethod] ?? paymentMethod}`;
            await reply(
                phoneE164,
                `✅ *Pedido confirmado!* 🍺\n\n${formatCart(cartSnapshot)}\n\n📍 Endereço: ${address}\n${paymentLine}\n🔖 Pedido: #${orderShort}\n\n📦 Recebemos seu pedido e já estamos preparando!\n_Obrigado por pedir no ${companyName}!_`
            );
            try {
                const accompaniments = await getAccompanimentItems(admin, companyId, cartSnapshot.map((c) => c.variantId));
                if (accompaniments.length > 0) {
                    const lines = accompaniments.map((v) => {
                            return `• ${buildProductDisplayName(v)} — ${formatCurrency(v.unitPrice)}`;
                    });
                    await reply(phoneE164, `🛒 *Que tal adicionar ao seu pedido?*\n\n${lines.join("\n")}\n\n_Digite *1* para ver o cardápio completo ou *menu* para voltar ao início._`);
                }
            } catch { /* ignore */ }
            return;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[checkout_confirm] ERRO ao criar pedido:", msg);
            await reply(phoneE164, "Desculpe, houve um erro ao registrar seu pedido. Por favor, fale com um atendente. 😞");
            return;
        }
    }

    // Etapa: aguardando confirmação de maioridade
    if (session.context.awaiting_age_confirm) {
        if (matchesAny(input, ["sim", "s", "sou maior", "maior", "confirmar", "confirmo"])) {
            // Marca cliente como adulto
            if (session.customer_id) {
                await admin.from("customers").update({ is_adult: true }).eq("id", session.customer_id);
            } else {
                const phoneClean = phoneE164.replace(/\D/g, "");
                const { data: existing } = await admin
                    .from("customers")
                    .select("id")
                    .eq("company_id", companyId)
                    .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
                    .limit(1)
                    .maybeSingle();
                if (existing?.id) {
                    await admin.from("customers").update({ is_adult: true }).eq("id", existing.id);
                }
            }

            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, awaiting_age_confirm: false },
            });
            // Após confirmar maioridade, segue fluxo normal de confirmação abaixo
        } else if (matchesAny(input, ["nao", "não", "n", "sou menor", "menor"])) {
            await reply(
                phoneE164,
                "Para continuar, é necessário ser maior de 18 anos. Seu pedido não foi finalizado."
            );
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            return;
        } else {
            await reply(
                phoneE164,
                "Por favor, responda *sim* se você é maior de 18 anos, ou *não* se não for."
            );
            return;
        }
    }

    // Input não reconhecido → reenviar resumo SEM cancelar o pedido
    if (!matchesAny(input, ["confirmar", "confirmar pedido", "confirmo", "sim", "ok", "s", "1"])) {
        await reply(phoneE164, "⚠️ Por favor, use os botões para confirmar ou alterar o pedido:");
        await sendOrderSummary(phoneE164, session);
        return;
    }

    let customerId = session.customer_id;
    if (!customerId) {
        console.warn("[checkout_confirm] customer_id ausente — tentando recuperar | threadId:", threadId);
        const recovered = await getOrCreateCustomer(admin, companyId, phoneE164);
        if (!recovered) {
            console.error("[checkout_confirm] Falha ao recuperar customer | threadId:", threadId);
            await reply(phoneE164, "Houve um erro interno. Por favor, tente novamente. 😞");
            return;
        }
        customerId = recovered.id;
        await saveSession(admin, threadId, companyId, { customer_id: customerId });
    }

    // Antes de criar o pedido: nome e maioridade (no final do fluxo)
    const { data: customerRow } = await admin
        .from("customers")
        .select("name, is_adult")
        .eq("id", customerId)
        .maybeSingle();

    const hasName = !!(customerRow?.name && String(customerRow.name).trim().length >= 2);
    if (!hasName) {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, awaiting_name_confirm: true },
        });
        await reply(phoneE164, "Para finalizar, qual é o seu *nome*?");
        return;
    }

    if (!customerRow?.is_adult) {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, awaiting_age_confirm: true },
        });
        await reply(
            phoneE164,
            "Para prosseguir com o pedido, confirme: você é *maior de 18 anos*? Responda *sim* ou *não*."
        );
        return;
    }

    try {
        const feeForOrder = (session.context.delivery_fee as number | null) ?? 0;
        const orderId     = await createOrder(admin, companyId, customerId, session.cart, paymentMethod, address, changeFor, feeForOrder);
        const orderShort = orderId.replace(/-/g, "").slice(-8).toUpperCase();

        console.log("[checkout_confirm] Pedido criado com sucesso | orderId:", orderId);

        // Limpeza de sessão assim que o insert retornar sucesso: cart zerado, step em home
        const cartSnapshot = [...session.cart];
        await saveSession(admin, threadId, companyId, {
            step:    "main_menu",
            cart:    [],
            context: { last_order_id: orderId },
        });

        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const paymentLine = paymentMethod === "cash"
            ? `💳 Pagamento: Dinheiro${changeFor ? ` (troco para ${formatCurrency(changeFor)})` : ""}`
            : `💳 Pagamento: ${pmLabels[paymentMethod] ?? paymentMethod}`;

        await reply(
            phoneE164,
            `✅ *Pedido confirmado!* 🍺\n\n` +
            `${formatCart(cartSnapshot)}\n\n` +
            `📍 Endereço: ${address}\n` +
            `${paymentLine}\n` +
            `🔖 Pedido: #${orderShort}\n\n` +
            `📦 Recebemos seu pedido e já estamos preparando!\n` +
            `_Obrigado por pedir no ${companyName}!_`
        );

        // ── Sugestão de acompanhamentos (baseado no que comprou) ────────────────
        try {
            const cartEmbalagemIds = cartSnapshot.map((c) => c.variantId);
            const accompaniments = await getAccompanimentItems(admin, companyId, cartEmbalagemIds);
            if (accompaniments.length > 0) {
                const lines = accompaniments.map((v) => {
                    return `• ${buildProductDisplayName(v)} — ${formatCurrency(v.unitPrice)}`;
                });
                await reply(
                    phoneE164,
                    `🛒 *Que tal adicionar ao seu pedido?*\n\n${lines.join("\n")}\n\n` +
                    `_Digite *1* para ver o cardápio completo ou *menu* para voltar ao início._`
                );
            }
        } catch { /* não bloqueia o fluxo principal */ }

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[checkout_confirm] ERRO ao criar pedido:", msg);
        await reply(
            phoneE164,
            `Desculpe, houve um erro ao registrar seu pedido. Por favor, fale com um atendente. 😞`
        );
    }
}

// ─── AWAITING_VARIANT_SELECTION ───────────────────────────────────────────────

async function handleAwaitingVariantSelection(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const variantOptions = (session.context.variant_options as VariantRow[]) ?? [];
    if (!variantOptions.length) {
        await saveSession(admin, threadId, companyId, { step: "catalog_products" });
        await reply(phoneE164, "Não encontrei as opções anteriores. O que você gostaria?");
        return;
    }

    const defaultQty = Number(session.context.variant_qty ?? 1);

    // Parse selections: support "3x1", "2 x 1", "1 2 3", single numbers
    interface Sel { idx: number; qty: number }
    const selections: Sel[] = [];

    // Try "NxM" or "N x M" format first (qty x option)
    const qxoRe = /(\d+)\s*x\s*(\d+)/gi;
    let qxoMatch: RegExpExecArray | null;
    let hasQxo = false;
    const inputForParsing = input;
    while ((qxoMatch = qxoRe.exec(inputForParsing)) !== null) {
        const q = parseInt(qxoMatch[1], 10);
        const opt = parseInt(qxoMatch[2], 10) - 1;
        if (opt >= 0 && opt < variantOptions.length) {
            selections.push({ idx: opt, qty: q });
            hasQxo = true;
        }
    }

    if (!hasQxo) {
        // Fall back: each space/comma separated number = one option, qty = defaultQty
        const nums = input.split(/[\s,]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= variantOptions.length);
        for (const n of nums) {
            const existing = selections.find(s => s.idx === n - 1);
            if (existing) existing.qty += defaultQty;
            else selections.push({ idx: n - 1, qty: defaultQty });
        }
    }

    if (!selections.length) {
        const listText = variantOptions.map((v, i) => {
            const nm = buildProductDisplayName(v);
            return `${NUMBER_EMOJIS[i] ?? `${i+1}.`} *${nm}* — ${formatCurrency(v.unitPrice)}`;
        }).join("\n");
        await reply(phoneE164, `Digite o número da opção:\n\n${listText}\n\n_Ex: "1" para primeira opção, "1 2" para duas opções, "3x1" para 3 unidades da opção 1_`);
        return;
    }

    let newCart = [...session.cart];
    const addedItems: string[] = [];

    for (const sel of selections) {
        const v = variantOptions[sel.idx];
        if (!v) continue;
        const name = buildProductDisplayName(v);
        const cartIdx = newCart.findIndex(c => c.variantId === v.id);
        if (cartIdx >= 0) {
            newCart[cartIdx] = { ...newCart[cartIdx], qty: newCart[cartIdx].qty + sel.qty };
        } else {
            newCart.push({ variantId: v.id, productId: v.productId, name, price: v.unitPrice, qty: sel.qty, isCase: false });
        }
        addedItems.push(`${sel.qty}x ${name}`);
    }

    const total = newCart.reduce((s, i) => s + i.price * i.qty, 0);
    await saveSession(admin, threadId, companyId, {
        step: "catalog_products",
        cart: newCart,
        context: { ...session.context, variant_options: undefined, variant_qty: undefined },
    });

    const cartText = newCart.length > 0 ? `\n\n🛒 *Pedido:*\n${formatCart(newCart)}\n\n💰 *Total: ${formatCurrency(total)}*` : "";
    await sendInteractiveButtons(
        phoneE164,
        `✅ Adicionado: ${addedItems.join(", ")}!${cartText}\n\nQuer mais alguma coisa?`,
        [
            { id: "mais_produtos", title: "Mais produtos" },
            { id: "finalizar",     title: "Finalizar pedido" },
        ]
    );
}

// ─── AWAITING_SPLIT_ORDER ──────────────────────────────────────────────────────

async function handleAwaitingSplitOrder(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const normInput = normalize(input);
    const isSplit = normInput === "1" || /\bsepar/i.test(input);
    const isSingle = normInput === "2" || /\b(mesmo|unico|único|so um)\b/i.test(input);

    if (isSplit) {
        await saveSession(admin, threadId, companyId, {
            step: "checkout_address",
            context: { ...session.context, split_order: true, awaiting_address: true },
        });
        await reply(phoneE164, "📍 Dois pedidos separados! Qual é o *primeiro endereço de entrega*?");
        return;
    }

    if (isSingle) {
        const addr1 = (session.context.split_address_1 as string) ?? "";
        const addr2 = (session.context.split_address_2 as string) ?? "";
        await saveSession(admin, threadId, companyId, {
            step: "catalog_products",
            context: {
                ...session.context,
                split_order: false,
                delivery_address: addr1 && addr2 ? `${addr1} / ${addr2}` : addr1 || addr2,
            },
        });
        await reply(phoneE164, `📍 Certo! Entregaremos em *${addr1}* e *${addr2}*.\n\nContinue adicionando produtos ou finalize o pedido.`);
        return;
    }

    await reply(
        phoneE164,
        "Serão dois pedidos com pagamentos diferentes ou somente um pedido entregue em dois endereços?\n\n" +
        "1️⃣ Dois pedidos separados\n2️⃣ Um pedido, dois endereços"
    );
}

// ─── HANDOVER ─────────────────────────────────────────────────────────────────

async function doHandover(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<void> {
    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId),

        saveSession(admin, threadId, companyId, { ...session, step: "handover" }),
    ]);

    await reply(
        phoneE164,
        `👋 Vou te conectar com um atendente do *${companyName}*.\n\n` +
        `_Aguarde, alguém responderá em breve._`
    );
}
