/**
 * lib/chatbot/handlers/handleCatalog.ts
 *
 * Handlers para as etapas de catálogo: categorias, marcas e produtos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, Category, Brand, VariantRow } from "../types";
import { saveSession } from "../session";
import {
    normalize, truncateTitle, isCaseVariant, formatCurrency,
    formatCart, cartTotal, NUMBER_EMOJIS,
} from "../utils";
import {
    getCategories, getVariantsByCategory, getVariantsByBrandAndCategory,
    findDeliveryZone, listDeliveryZones,
} from "../db/variants";
import { handleFreeTextInput } from "./handleFreeText";
import { buildProductDisplayName } from "../displayHelpers";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage, sendListMessageSections } from "../../whatsapp/send";

// ─── Regex de módulo ──────────────────────────────────────────────────────────
const MAIS_PRODUTOS_RE = /\bmais\s+produtos\b/iu;
const VER_CARRINHO_RE  = /\bver\s+carrinho\b/iu;
const CARRINHO_RE      = /\bcarrinho\b/iu;
const FINALIZAR_RE     = /\bfinalizar\b/iu;
const FECHAR_RE        = /\bfechar\b/iu;
const CHECKOUT_CAT_RE  = /\bcheckout\b/iu;
const ONLY_NUMS_RE     = /^[\d,\s]+$/u;
const HAS_DIGIT_RE     = /\d/u;
const SPLIT_NUMS_RE    = /[,\s]+/u;
const PARTS_SPLIT_RE   = /\s+/u;

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

function formatNumberedList(variants: VariantRow[]): string {
    return variants.map((v, i) => {
        const isCase = isCaseVariant(v);
        const name   = buildProductDisplayName(v, isCase);
        const price  = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
        const emoji  = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
        return `${emoji} *${name}* — ${formatCurrency(price)}`;
    }).join("\n");
}

// ─── Exibição de produtos/marcas ──────────────────────────────────────────────

export async function sendBrandsList(
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

export async function sendVariantsList(
    phoneE164: string,
    variants: VariantRow[],
    catName: string,
    brandName: string
): Promise<void> {
    // Unitários: apenas variantes que NÃO são CX-only
    const unitVariants = variants.filter((v) => !isCaseVariant(v));
    const unitRows = unitVariants.map((v) => ({
        id:          v.id,
        title:       truncateTitle(buildProductDisplayName(v, false)),
        description: formatCurrency(v.unitPrice),
    }));

    // Caixas: variantes que têm preço de caixa (UN+CX e CX-only)
    const caseVariants = variants.filter((v) => v.hasCase && v.casePrice);

    const sections: Array<{ title: string; rows: typeof unitRows }> = [];

    if (unitRows.length > 0) {
        sections.push({ title: "Unitário", rows: unitRows });
    }

    if (caseVariants.length > 0) {
        sections.push({
            title: "Caixa",
            rows:  caseVariants.map((v) => ({
                id:          isCaseVariant(v) ? v.id : `${v.id}_case`,
                title:       truncateTitle(buildProductDisplayName(v, true)),
                description: formatCurrency(v.casePrice ?? 0),
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

// ─── handleCatalogCategories ──────────────────────────────────────────────────

export async function handleCatalogCategories(
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

// ─── handleCatalogBrands ──────────────────────────────────────────────────────

export async function handleCatalogBrands(
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
    if (input === "mais_produtos" || MAIS_PRODUTOS_RE.test(input)) {
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

// ─── handleCatalogProducts ────────────────────────────────────────────────────

export async function handleCatalogProducts(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session,
    goToCheckoutFromCartFn: (admin: SupabaseClient, companyId: string, threadId: string, phoneE164: string, session: Session) => Promise<void>,
    goToCartFn: (admin: SupabaseClient, companyId: string, threadId: string, phoneE164: string, session: Session) => Promise<void>
): Promise<void> {
    const variants   = (session.context.variants    as VariantRow[]) ?? [];
    const catName    = (session.context.category_name as string)     ?? "Produtos";
    const brandName  = (session.context.brand_name   as string)      ?? "";

    // ── Mais produtos → volta ao início do catálogo ───────────────────────────
    if (input === "mais_produtos" || MAIS_PRODUTOS_RE.test(input)) {
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
    const looksNumeric     = ONLY_NUMS_RE.test(input.trim()) && HAS_DIGIT_RE.test(input);

    if (isNumberedSearch && looksNumeric && !session.context.pending_variant) {
        // Parse: "2" → [1]   "1,3" → [0,2]   "1 3 5" → [0,2,4]
        const indices = input
            .split(SPLIT_NUMS_RE)
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((i) => !isNaN(i) && i >= 0 && i < variants.length);

        if (!indices.length) {
            const listText = formatNumberedList(variants.slice(0, 5));
            await reply(phoneE164, `Número inválido. Escolha entre 1 e ${Math.min(variants.length, 5)}:\n\n${listText}`);
            return;
        }

        if (indices.length === 1) {
            // Seleção simples → pergunta quantidade
            const v       = variants[indices[0]];
            const isCaseV = isCaseVariant(v);
            const vPrice  = isCaseV ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
            const label   = `*${buildProductDisplayName(v, isCaseV)}* — ${formatCurrency(vPrice)}`;
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
            const isCase   = isCaseVariant(v);
            const itemName = buildProductDisplayName(v, isCase);
            const price    = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
            const existing = newCart.findIndex((c) => c.variantId === v.id && c.isCase === isCase);
            if (existing >= 0) {
                newCart[existing] = { ...newCart[existing], qty: newCart[existing].qty + 1 };
            } else {
                newCart.push({ variantId: v.id, productId: v.productId, name: itemName, price, qty: 1, isCase });
            }
            addedLines.push(`✅ 1x *${itemName}* — ${formatCurrency(price)}`);
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
    if (input === "ver_carrinho" || CARRINHO_RE.test(input) || VER_CARRINHO_RE.test(input)) {
        await goToCartFn(admin, companyId, threadId, phoneE164, session);
        return;
    }

    if (input === "finalizar" || FINALIZAR_RE.test(input) || FECHAR_RE.test(input) || CHECKOUT_CAT_RE.test(input)) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Escolha um produto primeiro.");
            return;
        }
        await goToCheckoutFromCartFn(admin, companyId, threadId, phoneE164, session);
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
            const parts = input.trim().split(PARTS_SPLIT_RE).filter(Boolean);
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
