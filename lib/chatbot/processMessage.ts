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
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage, sendListMessageSections } from "@/lib/whatsapp/send";

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

// ─── Processamento de linguagem natural ───────────────────────────────────────

/** Palavras que não carregam informação de produto e devem ser ignoradas na busca. */
const STOPWORDS = new Set([
    // intenção / verbos
    "quero","quer","queria","gostaria","pode","manda","mande","traz","traga",
    "ve","ver","preciso","quero pedir","to querendo","vou querer","quero ver",
    "comprar","pedir","adicionar","colocar","botar","busca","buscar",
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
]);

/**
 * Remove stopwords e retorna os termos relevantes.
 * Ex: "quero 3 skol lata por favor" → ["3","skol","lata"]
 * Ex: "Quero 3 cerveja Skol" → ["3","cerveja","skol"]
 */
function extractTerms(input: string): string[] {
    const words = normalize(input).split(/[\s,;:!?]+/);
    return words.filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Extrai quantidade numérica de uma lista de termos.
 * Returns { qty, terms } where terms has the number removed.
 */
function extractQuantity(terms: string[]): { qty: number; terms: string[] } {
    let qty = 1;
    const rest: string[] = [];
    for (const t of terms) {
        const n = parseInt(t, 10);
        if (!isNaN(n) && n >= 1 && n <= 99 && /^\d+$/.test(t)) {
            qty = n;
        } else {
            rest.push(t);
        }
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
        const vol   = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
        const name  = `${v.productName}${vol}`.trim();
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
    const ADDR_RE = /\b(rua|r\.|av\.?|avenida|alameda|travessa|trav\.?|estrada|rodovia|pra[cç]a|p[cç][ao]\.?|beco|viela|setor|quadra|qd\.?)\s+([\wÀ-úÀ-ÿ\s]{2,50?}?)[\s,]*(?:n[º°oa]?\.?\s*)?(\d{1,5})\b/i;

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
    unitPrice:       number;
    hasCase:         boolean;
    caseQty:         number | null;
    casePrice:       number | null;
    // ID da embalagem CX (para debitar estoque) quando `isCase === true`.
    // No novo modelo, `id` é o ID da embalagem UN (unit).
    caseVariantId?: string;
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

    const byProd: Record<string, { unit: any | null; case: any | null }> = {};
    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        byProd[pid] ??= { unit: null, case: null };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" || sig === "UNIDADE") byProd[pid].unit = r;
        if (sig === "CX" || sig === "CAIXA") byProd[pid].case = r;
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

    const byProd: Record<string, { unit: any | null; case: any | null }> = {};
    const prodOrder: string[] = [];
    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        if (!byProd[pid]) {
            byProd[pid] = { unit: null, case: null };
            prodOrder.push(pid);
        }
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN") byProd[pid].unit = r;
        if (sig === "CX") byProd[pid].case = r;
    }

    const variants: VariantRow[] = [];
    for (const pid of prodOrder) {
        const unitPack = byProd[pid]?.unit ?? null;
        const casePack = byProd[pid]?.case ?? null;
        if (!unitPack && !casePack) continue;

        const p = unitPack ?? casePack;
        variants.push({
            id: String(unitPack?.id ?? casePack?.id ?? pid),
            productId: pid,
            productName: String(p?.product_name ?? ""),
            details: (unitPack?.descricao ?? casePack?.descricao ?? p?.product_details ?? null) as string | null,
            tags: unitPack?.tags ?? casePack?.tags ?? null,
            volumeValue: 0,
            unit: String(p?.product_unit_type ?? "un"),
            unitPrice: Number(unitPack?.preco_venda ?? 0),
            hasCase: Boolean(casePack),
            caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
            casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
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
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
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
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
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
        .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, is_acompanhamento, sigla_comercial, product_name, product_unit_type, product_details, volume_quantidade")
        .eq("company_id", companyId)
        .limit(800);

    if (error) {
        console.error("[searchV2] erro Supabase:", error.message);
        return [];
    }
    if (!data?.length) return [];

    // 1) Agrupar por produto (Pai)
    const byProd: Record<string, {
        unitPack: any | null;
        casePack: any | null;
        tags: string[];
    }> = {};

    for (const r of data as any[]) {
        const pid = String(r.produto_id);
        byProd[pid] ??= { unitPack: null, casePack: null, tags: [] };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN") byProd[pid].unitPack = r;
        if (sig === "CX") byProd[pid].casePack = r;
        if (r.tags) byProd[pid].tags.push(String(r.tags));
    }

    const variants: VariantRow[] = Object.entries(byProd)
        .map(([pid, grp]) => {
            const unitPack = grp.unitPack ?? grp.casePack;
            const casePack = grp.casePack;
            if (!unitPack) return null;

            const p = unitPack;
            const volQty = Number(unitPack.volume_quantidade ?? 0);
            const volUnit = String(p.product_unit_type ?? "un");
            return {
                id: String(unitPack.id),
                productId: pid,
                productName: String(p.product_name ?? ""),
                details: (unitPack.descricao ?? p.product_details ?? null) as string | null,
                tags: grp.tags.length ? grp.tags.join(",") : null,
                volumeValue: volQty,
                unit: volUnit,
                unitPrice: Number(unitPack.preco_venda ?? 0),
                hasCase: Boolean(casePack),
                caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
                casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
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
    // ── 0. Detecção de endereço (+ produto combinado) na mesma mensagem ──────
    const addrMatch = extractAddressFromText(rawInput);
    if (addrMatch) {
        console.log("[freetext] endereço detectado:", addrMatch.full, "| bairro:", addrMatch.neighborhood);

        // Tenta encontrar produto na parte da mensagem sem o endereço
        const textWithoutAddr = rawInput.replace(addrMatch.rawSlice, " ").trim();
        const productTerms    = extractTerms(textWithoutAddr);
        const { qty: pQty, terms: pTerms } = extractQuantity(productTerms);
        const foundProducts = pTerms.length >= 1
            ? await searchVariantsByText(admin, companyId, pTerms)
            : [];
        const bestProduct = foundProducts[0] ?? null;

        // Busca zona de entrega pelo bairro detectado
        let zone: DeliveryZone | null = null;
        if (addrMatch.neighborhood) {
            zone = await findDeliveryZone(admin, companyId, addrMatch.neighborhood);
        }

        // Salva endereço + taxa no contexto
        const newContext: Record<string, unknown> = {
            ...session.context,
            delivery_address:   addrMatch.full,
            delivery_fee:       zone?.fee ?? null,
            delivery_zone_id:   zone?.id  ?? null,
            awaiting_neighborhood: !zone && !addrMatch.neighborhood ? true : (!zone && !!addrMatch.neighborhood),
            pending_neighborhood: !zone && addrMatch.neighborhood ? addrMatch.neighborhood : null,
        };

        let newCart = [...session.cart];

        // Adiciona produto ao carrinho se encontrado
        if (bestProduct) {
            const vol  = bestProduct.volumeValue ? ` ${bestProduct.volumeValue}${bestProduct.unit}` : "";
            const name = `${bestProduct.productName}${vol}`.trim();
            const qty  = pQty >= 1 ? pQty : 1;
            const idx  = newCart.findIndex((c) => c.variantId === bestProduct.id && !c.isCase);
            if (idx >= 0) {
                newCart[idx] = { ...newCart[idx], qty: newCart[idx].qty + qty };
            } else {
                newCart.push({ variantId: bestProduct.id, productId: bestProduct.productId, name, price: bestProduct.unitPrice, qty, isCase: false });
            }
        }

        await saveSession(admin, threadId, companyId, {
            step:    "catalog_products",
            cart:    newCart,
            context: newContext,
        });

        // ── Caso combinado: produto + endereço + zona encontrada ─────────────
        if (bestProduct && zone) {
            const vol       = bestProduct.volumeValue ? ` ${bestProduct.volumeValue}${bestProduct.unit}` : "";
            const itemName  = `${bestProduct.productName}${vol}`.trim();
            const itemQty   = pQty >= 1 ? pQty : 1;
            const cartWithFee = cartTotal(newCart) + zone.fee;
            await sendInteractiveButtons(
                phoneE164,
                `🍻 *Excelente escolha!*\n\n` +
                `✅ ${itemQty}x *${itemName}* anotado.\n` +
                `📍 Entrega na *${addrMatch.full}*\n` +
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
            const vol      = bestProduct.volumeValue ? ` ${bestProduct.volumeValue}${bestProduct.unit}` : "";
            const itemName = `${bestProduct.productName}${vol}`.trim();
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
        if (zone) {
            const cartSummary = newCart.length > 0 ? `\n\n🛒 *Pedido atual:*\n${formatCart(newCart)}` : "";
            await sendInteractiveButtons(
                phoneE164,
                `📍 Entendido! Endereço anotado:\n*${addrMatch.full}*\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*${cartSummary}\n\nAlgo mais ou posso fechar?`,
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

    // ── 1. Extração de termos ─────────────────────────────────────────────────
    const allTerms = extractTerms(rawInput);

    console.log(`[freetext] input: "${rawInput}" | todos os termos extraídos:`, allTerms);

    if (!allTerms.length) {
        console.log("[freetext] → skip (sem termos após remover stopwords)");
        return "skip";
    }

    const { qty, terms } = extractQuantity(allTerms);

    console.log(`[freetext] termos de busca: [${terms.join(", ")}] | quantidade detectada: ${qty}`);

    if (!terms.length) {
        console.log("[freetext] → skip (só tinha números, sem termos de produto)");
        return "skip";
    }

    const found = await searchVariantsByText(admin, companyId, terms);

    console.log(`[freetext] produtos encontrados no Supabase: ${found.length}`, found.map(v => v.productName));

    // ── Nenhum resultado ──────────────────────────────────────────────────────
    if (!found.length) {
        console.log("[freetext] → notfound (nenhuma variante correspondeu)");
        return "notfound";
    }

    // ── Match único → confirmação automática ou pergunta de quantidade ────────
    if (found.length === 1) {
        const v        = found[0];
        const volLabel = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
        const name     = `${v.productName}${volLabel}`.trim();

        if (qty > 1) {
            // Quantidade extraída da mensagem → adiciona direto ao carrinho
            const newItem: CartItem = {
                variantId: v.id,
                productId: v.productId,
                name,
                price:   v.unitPrice,
                qty,
                isCase:  false,
            };
            const existingIdx = session.cart.findIndex(
                (i) => i.variantId === v.id && !i.isCase
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
                    variants:       found,
                    brand_name:     "Resultados",
                    category_name:  "Busca",
                    pending_variant: null,
                    pending_is_case: null,
                },
            });

            await sendInteractiveButtons(
                phoneE164,
                `✅ Certo! Adicionei *${qty}x ${name}* (${formatCurrency(v.unitPrice * qty)}) ao seu pedido.\n\n${formatCart(newCart)}\n\nDeseja mais alguma coisa ou podemos fechar?`,
                [
                    { id: "mais_produtos", title: "Mais produtos" },
                    { id: "ver_carrinho",  title: "Ver carrinho" },
                    { id: "finalizar",     title: "Finalizar pedido" },
                ]
            );
            return "handled";
        }

        // Sem quantidade → pergunta quanto quer
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_products",
            context: {
                ...session.context,
                variants:         found,
                brand_name:       "Resultados",
                category_name:    "Busca",
                pending_variant:  v,
                pending_is_case:  false,
                unit_case_choice: Boolean(v.hasCase && v.casePrice), // UN + CX numerados
            },
        });

        if (v.hasCase && v.casePrice) {
            const cxLabel = `caixa ${v.caseQty}un`;
            await reply(
                phoneE164,
                `Encontrei:\n\n` +
                `1. *${name}* — ${formatCurrency(v.unitPrice)}\n` +
                `2. *${v.productName}* ${cxLabel} — ${formatCurrency(v.casePrice)}\n\n` +
                `Qual opção e quantas unidades deseja?`
            );
        } else {
            await reply(
                phoneE164,
                `Encontrei *${name}* por *${formatCurrency(v.unitPrice)}*. 🍺\n\nQuantas unidades deseja?`
            );
        }
        return "handled";
    }

    // ── Múltiplos resultados → lista numerada em texto puro ──────────────────
    // Máximo 5 opções visíveis; se houver mais avisa para refinar a busca.
    const MAX_SHOWN = 5;
    const displayed = found.slice(0, MAX_SHOWN);
    const hasMore   = found.length > MAX_SHOWN;

    // Salva TODOS os resultados no contexto + flag de seleção numérica
    await saveSession(admin, threadId, companyId, {
        step:    "catalog_products",
        context: {
            ...session.context,
            variants:        found,   // lista completa preservada para ver_mais
            brand_name:      "Resultados",
            category_name:   "Busca",
            pending_variant: null,
            pending_is_case: null,
            search_numbered: true,    // flag: próximo input numérico = seleção
        },
    });

    const listText = formatNumberedList(displayed);
    const moreHint = hasMore
        ? `\n\n_Mostrando ${MAX_SHOWN} de ${found.length} opções. Digite o nome para refinar a busca._`
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
                    unitPrice: Number(r.preco_venda ?? 0),
                    hasCase: false,
                    caseQty: null,
                    casePrice: null,
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
                    unitPrice: Number(unitPack.preco_venda ?? 0),
                    hasCase: Boolean(casePack),
                    caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
                    casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
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
    const { admin, companyId, threadId, phoneE164, text, profileName } = params;

    console.log("[chatbot] processInboundMessage START | thread:", threadId, "company:", companyId, "text:", text);

    const input = text.trim();
    if (!input) {
        console.log("[chatbot] input vazio, ignorando");
        return;
    }

    // Verifica se existe bot ativo para esta empresa
    const { data: botRows, error: botErr } = await admin
        .from("chatbots")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    console.log("[chatbot] chatbots ativos:", botRows?.length ?? 0, botErr ? `| erro: ${botErr.message}` : "");

    if (!botRows?.length) {
        console.warn("[chatbot] Nenhum chatbot ativo para company:", companyId, "— verifique tabela chatbots");
        return;
    }

    const [company, session] = await Promise.all([
        getCompanyInfo(admin, companyId),
        getOrCreateSession(admin, threadId, companyId),
    ]);

    const companyName = company?.name ?? "nossa loja";
    const settings    = company?.settings ?? {};

    console.log("[chatbot] session step:", session.step, "| cartItems:", session.cart.length, "| input:", input);

    // ── Comandos globais (funcionam em qualquer etapa) ────────────────────────

    if (matchesAny(input, ["cancelar", "reiniciar", "menu", "inicio", "comecar", "oi", "ola", "hello", "hi"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await reply(phoneE164, buildMainMenu(companyName));
        return;
    }

    if (matchesAny(input, ["atendente", "humano", "pessoa", "falar com alguem", "ajuda"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // ── Atalho global de checkout: "fechar", "pagar", "finalizar", "acabou" ──
    const CHECKOUT_KEYWORDS = ["fechar pedido","fechar","pagar","finalizar","acabou","checkout","quero pagar","fecha","bater caixa"];
    if (matchesAny(input, CHECKOUT_KEYWORDS) && session.cart.length > 0) {
        console.log("[chatbot] atalho de checkout detectado | cart:", session.cart.length);
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return;
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

        case "checkout_payment":
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "checkout_confirm":
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, input, session);
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
            context: { categories },
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

    if (ftResult === "notfound") {
        await reply(phoneE164, `Não encontrei _"${input}"_.\n\n${getMenuOptionsOnly()}`);
        return;
    }

    // Input inválido → repete menu
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
        title:       truncateTitle(`${v.productName}${v.volumeValue ? ` ${v.volumeValue}${v.unit}` : ""} - ${formatCurrency(v.unitPrice)}`),
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
                title:       truncateTitle(`${v.caseQty}un - ${v.productName}${v.volumeValue ? ` ${v.volumeValue}${v.unit}` : ""}`),
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
            const vol     = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
            const label   = `*${v.productName}${vol}* — ${formatCurrency(v.unitPrice)}`;
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
            const vol      = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
            const itemName = `${v.productName}${vol}`.trim();
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

        const isCase   = unitCaseChoice ? opt === 2 : Boolean(pendingIsCase);
        const price    = isCase ? (pendingVariant.casePrice ?? pendingVariant.unitPrice) : pendingVariant.unitPrice;
        const volLabel = pendingVariant.volumeValue ? `${pendingVariant.volumeValue}${pendingVariant.unit}` : "";
        const name     = isCase
            ? (volLabel ? `${pendingVariant.productName} ${volLabel} (cx ${pendingVariant.caseQty}un)` : `${pendingVariant.productName} (cx ${pendingVariant.caseQty}un)`)
            : (volLabel ? `${pendingVariant.productName} ${volLabel}` : pendingVariant.productName);

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

    const volLabel = selectedVariant.volumeValue ? `${selectedVariant.volumeValue}${selectedVariant.unit}` : "";
    const label    = isCase
        ? `*${selectedVariant.productName}${volLabel ? " " + volLabel : ""} — Caixa com ${selectedVariant.caseQty}un* (${formatCurrency(selectedVariant.casePrice ?? 0)})`
        : `*${selectedVariant.productName}${volLabel ? " " + volLabel : ""}* (${formatCurrency(selectedVariant.unitPrice)})`;

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
        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const changeFor    = (session.context.change_for   as number | null) ?? null;
        const deliveryFee  = (session.context.delivery_fee as number | null) ?? 0;
        await saveSession(admin, threadId, companyId, { step: "checkout_confirm" });
        await sendOrderSummary(phoneE164, session.cart, address, pmLabels[payment] ?? payment, changeFor, deliveryFee);
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
    if (input.length < 10) {
        await reply(phoneE164, "Por favor, informe o endereço completo (rua, número e bairro).");
        return;
    }

    if (session.customer_id) {
        // Update legacy field (keeps chatbot flow intact)
        await admin.from("customers").update({ address: input, neighborhood: (session.context.delivery_neighborhood as string|null) ?? null }).eq("id", session.customer_id);

        // Upsert in enderecos_cliente — trigger on customers.address will also fire,
        // but we do it explicitly to set correct fields (logradouro, bairro, etc.)
        const bairro = (session.context.delivery_neighborhood as string|null) ?? null;
        const { data: existingAddr } = await admin
            .from("enderecos_cliente")
            .select("id")
            .eq("customer_id", session.customer_id)
            .eq("apelido", "Chatbot")
            .maybeSingle();

        if (existingAddr?.id) {
            await admin.from("enderecos_cliente").update({
                logradouro:   input,
                bairro:       bairro,
                is_principal: true,
            }).eq("id", existingAddr.id);
        } else {
            await admin.from("enderecos_cliente").insert({
                company_id:   companyId,
                customer_id:  session.customer_id,
                apelido:      "Chatbot",
                logradouro:   input,
                bairro:       bairro,
                is_principal: true,
            });
        }
    }

    await saveSession(admin, threadId, companyId, {
        step:        "checkout_payment",
        customer_id: session.customer_id,
        context:     {
            ...session.context,
            delivery_address: input,
            saved_address:    null,
            awaiting_address: false,
        },
    });

    await sendPaymentButtons(phoneE164);
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

async function sendOrderSummary(
    phoneE164: string,
    cart: CartItem[],
    address: string,
    paymentLabel: string,
    changeFor: number | null,
    deliveryFee = 0
): Promise<void> {
    const changeText   = changeFor   ? `\n💵 Troco: ${formatCurrency(changeFor)}` : "";
    const feeText      = deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}` : "";
    const productsTotal = cartTotal(cart);
    const grandTotal    = productsTotal + deliveryFee;
    const grandText     = deliveryFee > 0
        ? `\n\n💰 *Total final: ${formatCurrency(grandTotal)}*`
        : "";

    await reply(
        phoneE164,
        `📋 *Resumo do pedido:*\n\n` +
        `${formatCart(cart)}\n` +
        `${feeText}\n` +
        `📍 Entrega: ${address}\n` +
        `💳 Pagamento: ${paymentLabel}${changeText}` +
        `${grandText}\n\n` +
        `_Digite *alterar endereço* para mudar o endereço._`
    );
    await sendInteractiveButtons(
        phoneE164,
        "Confirmar o pedido?",
        [
            { id: "confirmar",          title: "Confirmar pedido"   },
            { id: "adicionar_produtos", title: "Adicionar produtos" },
            { id: "cancelar",           title: "Cancelar"           },
        ]
    );
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
        const feeD = (session.context.delivery_fee as number | null) ?? 0;
        await sendOrderSummary(phoneE164, session.cart, address, "Dinheiro", changeFor, feeD);
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

    const method = paymentMap[normalize(input)];
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
    const paymentLabel = method === "pix" ? "PIX" : "Cartão";
    await saveSession(admin, threadId, companyId, {
        step:    "checkout_confirm",
        context: { ...session.context, payment_method: method },
    });
    const deliveryFeeP = (session.context.delivery_fee as number | null) ?? 0;
    await sendOrderSummary(phoneE164, session.cart, address, paymentLabel, null, deliveryFeeP);
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

    // "Alterar endereço" → volta ao fluxo de endereço para informar novo
    if (matchesAny(input, ["alterar_endereco", "alterar endereco", "alterar endereço", "mudar endereço", "trocar endereço"])) {
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

    // "Adicionar produtos" → volta ao catálogo preservando carrinho, endereço e pagamento
    if (matchesAny(input, ["adicionar_produtos", "adicionar produtos"])) {
        const categories = await getCategories(admin, companyId);
        if (!categories.length) {
            await reply(phoneE164, "Nenhuma categoria disponível. Tente novamente.");
            return;
        }
        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories },
            // cart não é alterado — produtos preservados
        });
        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria para adicionar mais produtos:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
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
            await saveSession(admin, threadId, companyId, {
                step: "done", cart: [], context: { last_order_id: orderId },
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
                        const vol = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
                        return `• ${v.productName}${vol}`.trim() + ` — ${formatCurrency(v.unitPrice)}`;
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
        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const pmLabel = pmLabels[paymentMethod] ?? paymentMethod;
        const feeC = (session.context.delivery_fee as number | null) ?? 0;
        await reply(phoneE164, "⚠️ Por favor, use os botões para confirmar ou cancelar o pedido:");
        await sendOrderSummary(phoneE164, session.cart, address, pmLabel, changeFor, feeC);
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

        // Snapshot do carrinho antes de limpar
        const cartSnapshot = [...session.cart];

        await saveSession(admin, threadId, companyId, {
            step:    "done",
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
                    const vol  = v.volumeValue ? ` ${v.volumeValue}${v.unit}` : "";
                    const name = `${v.productName}${vol}`.trim();
                    return `• ${name} — ${formatCurrency(v.unitPrice)}`;
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
