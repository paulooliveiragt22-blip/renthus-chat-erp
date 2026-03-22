/**
 * lib/chatbot/handlers/handleFreeText.ts
 *
 * Processador central de texto livre para o chatbot.
 * Extrai stopwords → quantidade → termos → busca no Supabase (OR scoring).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, VariantRow } from "../types";
import { saveSession } from "../session";
import {
    formatCurrency, formatCart, cartTotal, isCaseVariant,
    NUMBER_EMOJIS, mergeCart,
} from "../utils";
import {
    extractTerms, extractQuantity, hasVolumeClue,
    filterVariantsByPackaging, detectMultipleAddresses,
    extractAddressFromText,
} from "../textParsers";
import {
    searchVariantsByText, findDeliveryZone, listDeliveryZones,
} from "../db/variants";
import { buildProductDisplayName } from "../displayHelpers";
import { extractPackagingIntent, packagingLabel, isBulkPackaging } from "../PackagingExtractor";
import { getOrderParserService } from "../OrderParserService";
import { sendWhatsAppMessage, sendInteractiveButtons } from "../../whatsapp/send";

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * Processador central de texto livre.
 * Extrai stopwords → quantidade → termos → busca no Supabase (OR scoring).
 *
 * Retorna:
 *   "handled"  → mensagem respondida, caller não precisa fazer nada
 *   "notfound" → nenhum produto encontrado (caller pode exibir fallback)
 *   "skip"     → input muito curto/só stopwords, caller trata normalmente
 */
export async function handleFreeTextInput(
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
        let zone = null;
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
                    { id: "mais_produtos", title: "Ver cardápio" },
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
                    { id: "mais_produtos", title: "Ver cardápio" },
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

    // Remove stopwords do cleanText para busca no banco
    const terms = extractTerms(cleanText);

    if (!terms.length) return "skip";

    const found = await searchVariantsByText(admin, companyId, terms);

    // Filtra pelo tipo de embalagem pedido (ex: "cx" → só produtos com CX)
    const { filtered: foundFiltered, wasFiltered } = filterVariantsByPackaging(found, packagingSigla);

    // ── Nenhum resultado ──────────────────────────────────────────────────────
    if (!found.length) return "notfound";

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
        // Group by productId — all volume variants of a product share the same productId
        const byProductId = new Map<string, VariantRow[]>();
        for (const v of effective) {
            if (!byProductId.has(v.productId)) byProductId.set(v.productId, []);
            byProductId.get(v.productId)!.push(v);
        }

        // Show variant selection when all results are the same product
        if (byProductId.size === 1) {
            const variants = [...byProductId.values()][0];
            const displayName = effective[0].productName;
            const displayVariants: VariantRow[] = [];
            for (const v of variants) {
                displayVariants.push(v); // UN (ou CX-only já com id=caseVariantId)
                // Para UN+CX: adiciona a variante CX separada (CX-only não entra aqui pois id===caseVariantId)
                if (v.hasCase && v.caseVariantId && v.id !== v.caseVariantId) {
                    displayVariants.push({
                        ...v,
                        id: v.caseVariantId,
                        unitPrice: v.casePrice ?? v.unitPrice,
                    });
                }
            }

            if (displayVariants.length >= 1) {
                const listLines = displayVariants.slice(0, 9).map((v, i) => {
                    const emoji  = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
                    const isCase = isCaseVariant(v);
                    const price  = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
                    const name   = buildProductDisplayName(v, isCase);
                    return `${emoji} *${name}* — ${formatCurrency(price)}`;
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
                    `🍺 *${displayName}* — qual opção você quer?\n\n${listLines.join("\n")}\n\n_Digite o número da opção. Ex: *1* para opção 1, *1 2 3* para várias, *1x2 2x3* para quantidades (opção x qtd)_`
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
            const newItem = {
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
                    { id: "mais_produtos", title: "Ver cardápio" },
                    { id: "ver_carrinho",  title: "Editar itens" },
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
            variants:                found,
            brand_name:              "Resultados",
            category_name:           "Busca",
            pending_variant:         null,
            pending_is_case:         null,
            search_numbered:         true,
            pending_packaging_sigla: pkgExplicit ? packagingSigla : null,
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

// ─── Helper local ─────────────────────────────────────────────────────────────

function formatNumberedList(variants: VariantRow[]): string {
    return variants.map((v, i) => {
        const isCase = isCaseVariant(v);
        const name   = buildProductDisplayName(v, isCase);
        const price  = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
        const emoji  = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
        return `${emoji} *${name}* — ${formatCurrency(price)}`;
    }).join("\n");
}
