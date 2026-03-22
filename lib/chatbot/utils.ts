/**
 * lib/chatbot/utils.ts
 *
 * Funções utilitárias puras: normalização, formatação, cálculos de carrinho,
 * menus, horário de funcionamento. Sem dependências de handlers/ ou db/.
 */

import type { CartItem, VariantRow } from "./types";
import { buildProductDisplayName } from "./displayHelpers";

// ─── Normalização de texto ────────────────────────────────────────────────────

export function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/gu, "")
        .trim();
}

export function matchesAny(input: string, keywords: string[]): boolean {
    const n = normalize(input);
    return keywords.some((k) => n.includes(normalize(k)));
}

// ─── Stopwords ────────────────────────────────────────────────────────────────

/** Palavras que não carregam informação de produto e devem ser ignoradas na busca. */
export const STOPWORDS = new Set([
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

// ─── Quantidades por extenso ──────────────────────────────────────────────────

// Termos normalizados que podem virar quantidade (normalize() remove acentos).
export const QUANTITY_WORDS_NORM: Record<string, number> = {
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

// ─── Formatação ───────────────────────────────────────────────────────────────

export function formatCurrency(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

export function cartTotal(cart: CartItem[]): number {
    return cart.reduce((acc, i) => acc + i.price * i.qty, 0);
}

export function formatCart(cart: CartItem[]): string {
    if (!cart.length) return "Seu carrinho está vazio.";
    const lines = cart.map(
        (i, idx) => `${idx + 1}. ${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`
    );
    lines.push(`\n*Total: ${formatCurrency(cartTotal(cart))}*`);
    return lines.join("\n");
}

/** Trunca para o limite de 24 chars do title em list_message do WhatsApp. */
export function truncateTitle(text: string, maxLen = 24): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
}

// ─── Emojis numerados ─────────────────────────────────────────────────────────

export const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

// ─── Helpers de variante ──────────────────────────────────────────────────────

/**
 * Retorna true quando o VariantRow representa uma embalagem bulk (CX/FARD/PAC).
 * Dois casos: produto CX-only (id === caseVariantId) ou variante CX de produto UN+CX
 * adicionada ao displayVariants com id sobrescrito.
 */
export function isCaseVariant(v: VariantRow): boolean {
    return v.hasCase && !!v.caseVariantId && v.id === v.caseVariantId;
}

export function formatNumberedList(variants: VariantRow[]): string {
    return variants.map((v, i) => {
        const isCase = isCaseVariant(v);
        const name   = buildProductDisplayName(v, isCase);
        const price  = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
        const emoji  = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
        return `${emoji} *${name}* — ${formatCurrency(price)}`;
    }).join("\n");
}

// ─── Mescla de carrinho ───────────────────────────────────────────────────────

/** Mescla um array de novos itens no carrinho existente (soma qtd se já existe). */
export function mergeCart(existing: CartItem[], toAdd: CartItem[]): CartItem[] {
    const cart = [...existing];
    for (const item of toAdd) {
        const idx = cart.findIndex((c) => c.variantId === item.variantId && Boolean(c.isCase) === Boolean(item.isCase));
        if (idx >= 0) cart[idx] = { ...cart[idx], qty: cart[idx].qty + item.qty };
        else cart.push(item);
    }
    return cart;
}

// ─── Horário de funcionamento ─────────────────────────────────────────────────

export function isWithinBusinessHours(settings: Record<string, unknown>): boolean {
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

// ─── Menu principal ───────────────────────────────────────────────────────────

/** Apenas as opções 1,2,3 — usado quando busca falha (sem repetir saudação) */
export function getMenuOptionsOnly(): string {
    return `Como posso te ajudar?\n\n1️⃣  Ver cardápio\n2️⃣  Status do meu pedido\n3️⃣  Falar com atendente\n\n_Digite o número da opção._`;
}

/** Menu principal (1, 2, 3) — usado apenas quando busca por produto falha */
export function buildMainMenu(companyName: string, customerName?: string | null): string {
    const hasName = !!(customerName && customerName.trim().length > 0);
    const hello = hasName
        ? `Olá, *${customerName!.trim()}*! Seja bem-vindo(a) novamente ao *${companyName}* 🍺\n\n`
        : `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\n`;

    return hello + getMenuOptionsOnly();
}

/** Saudação inicial — prioriza pedido direto, não pede nome no início */
export function buildWelcomeGreeting(companyName: string, customerName?: string | null): string {
    const hasName = !!(customerName && customerName.trim().length > 0);
    if (hasName) {
        return `Olá, *${customerName!.trim()}*! O que manda pra hoje? 🍺\n\n_Digite o que deseja ou o endereço de entrega._`;
    }
    return `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nO que manda pra hoje? _Digite o que deseja._`;
}

// ─── Cross-sell helpers ───────────────────────────────────────────────────────

/** Palavras que indicam bebida → ativam sugestão de gelo/carvão. */
const DRINK_KEYWORDS = [
    "cerveja","chopp","vodka","rum","gin","whisky","whiskey","cachaca",
    "destilado","dose","longeck","lata","latinha","litrao","garrafa",
    "refrigerante","energetico","gelada","gelado","skol","brahma",
    "heineken","corona","budweiser","original","itaipava","amstel",
];

/** Retorna true se o nome do item parece uma bebida. */
export function isDrinkItem(name: string): boolean {
    const n = normalize(name);
    return DRINK_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Verifica se o carrinho tem pelo menos uma bebida MAS não tem gelo ou carvão.
 * Usado para disparar o cross-selling.
 */
export function needsCrossSell(cart: CartItem[]): boolean {
    const hasDrink    = cart.some((i) => isDrinkItem(i.name));
    const hasIceCoal  = cart.some((i) => {
        const n = normalize(i.name);
        return n.includes("gelo") || n.includes("carvao") || n.includes("carvão");
    });
    return hasDrink && !hasIceCoal;
}
