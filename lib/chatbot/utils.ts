/**
 * lib/chatbot/utils.ts
 *
 * Funções utilitárias puras: normalização, formatação, cálculos de carrinho,
 * menus, horário de funcionamento. Sem dependências de handlers/ ou db/.
 */

import type { CartItem } from "./types";

// ─── Normalização de texto ────────────────────────────────────────────────────

export function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036f]/gu, "")
        .trim();
}

export function matchesAny(input: string, keywords: string[]): boolean {
    const n = normalize(input);
    return keywords.some((k) => n.includes(normalize(k)));
}

// ─── Stopwords ────────────────────────────────────────────────────────────────

export const STOPWORDS = new Set([
    "quero","quer","queria","gostaria","pode","manda","mande","traz","traga",
    "ve","ver","preciso","quero pedir","to querendo","vou querer","quero ver",
    "comprar","pedir","adicionar","colocar","botar","busca","buscar",
    "acrescentar","botar","quero adicionar","quero botar","coloca","coloque",
    "poe","traz mais","manda mais","inclui","incluir","aumentar",
    "me","mim","pra","para","de","do","da","dos","das","um","uma","uns","umas",
    "o","a","os","as","eh","e","com","sem","por","no","na","nos","nas","ai","aqui",
    "la","la","aquele","aquela","voce","vc","tu","voce","isso","esse","essa",
    "esses","essas","desse","desta","dele","dela","este","esta","aqui","so","la",
    "mano","cara","brother","bro","pfv","pf","por favor","favor","obrigado","obg",
    "bom","boa","dia","tarde","noite","oi","ola","alo","tudo","bem","ate",
    "também","mais","só","somente","apenas","mesmo","mesma","tal",
    "produto","bebida","bebidas","item","itens","coisas","coisa","alguma",
    "alguem","algo","tem","ter","disponivel","em",
]);

// ─── Quantidades por extenso ──────────────────────────────────────────────────

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

export function truncateTitle(text: string, maxLen = 24): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
}

export const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

// ─── Mescla de carrinho ───────────────────────────────────────────────────────

export function mergeCart(existing: CartItem[], toAdd: CartItem[]): CartItem[] {
    const cart = [...existing];
    for (const item of toAdd) {
        const idx = cart.findIndex(
            (c) => c.variantId === item.variantId && Boolean(c.isCase) === Boolean(item.isCase)
        );
        if (idx >= 0) cart[idx] = { ...cart[idx], qty: cart[idx].qty + item.qty };
        else cart.push(item);
    }
    return cart;
}

// ─── Horário de funcionamento ─────────────────────────────────────────────────

export function isWithinBusinessHours(settings: Record<string, unknown>): boolean {
    const bh = settings?.business_hours as
        Record<string, { open?: boolean; from?: string; to?: string }> | undefined;
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

export function getMenuOptionsOnly(): string {
    return `Como posso te ajudar?\n\n1️⃣  Ver cardápio\n2️⃣  Status do meu pedido\n3️⃣  Falar com atendente\n\n_Digite o número da opção._`;
}

// ─── Sanitização de resposta Claude ──────────────────────────────────────────

const PRICE_RE   = /R\$\s*[\d.,]+/g;
const SAFE_REPLY = "Não encontrei esse item no nosso cardápio. Posso te mostrar o que temos disponível? 😊";

/**
 * Verifica se o texto gerado pelo Claude contém preços não catalogados.
 * Se encontrar, substitui por resposta segura para evitar alucinação de preço.
 */
export function sanitizeClaudeReply(text: string, catalogPrices: number[]): string {
    const pricesInText = text.match(PRICE_RE);
    if (!pricesInText) return text;

    for (const rawPrice of pricesInText) {
        const numeric = Number.parseFloat(rawPrice.replaceAll(/[R$\s]/g, "").replaceAll(",", "."));
        const isInCatalog = catalogPrices.some((p) => Math.abs(p - numeric) < 0.01);
        if (!isInCatalog) return SAFE_REPLY;
    }
    return text;
}

// ─── Cross-sell helpers ───────────────────────────────────────────────────────

const DRINK_KEYWORDS = [
    "cerveja","chopp","vodka","rum","gin","whisky","whiskey","cachaca",
    "destilado","dose","longeck","lata","latinha","litrao","garrafa",
    "refrigerante","energetico","gelada","gelado","skol","brahma",
    "heineken","corona","budweiser","original","itaipava","amstel",
];

export function isDrinkItem(name: string): boolean {
    const n = normalize(name);
    return DRINK_KEYWORDS.some((k) => n.includes(k));
}

export function needsCrossSell(cart: CartItem[]): boolean {
    const hasDrink   = cart.some((i) => isDrinkItem(i.name));
    const hasIceCoal = cart.some((i) => {
        const n = normalize(i.name);
        return n.includes("gelo") || n.includes("carvao") || n.includes("carvão");
    });
    return hasDrink && !hasIceCoal;
}
