/**
 * lib/chatbot/middleware/parserChain.ts
 *
 * Orquestra a cadeia Regex → Claude → Fallback e trata os resultados por intent.
 * Retorna { handled: true } quando a mensagem foi processada, { handled: false }
 * quando deve prosseguir para o step router.
 */

import type { Session, CompanyConfig } from "../types";
import type { ProcessMessageParams } from "../types";
import type { MessageIntent } from "../parsers/ClaudeParser";
import { saveSession } from "../session";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage } from "../../whatsapp/send";
import {
    matchesAny, formatCart, mergeCart, truncateTitle,
} from "../utils";
import {
    extractAddressFromText, detectPaymentMethod, cleanInputForAI, hasVolumeClue,
} from "../textParsers";
import { getCachedProducts } from "../TextParserService";
import { parsedItemsToCartItems } from "../OrderParserService";
import { parseWithFactory } from "../parsers/ParserFactory";
import { parseWithRegex, extractProductRequests } from "../parsers/RegexParser";
import { findProductWithPackaging } from "../parsers/ProductMatcher";
import { findDeliveryZone } from "../db/variants";
import { replyWithOrderStatus } from "../db/orders";
import { handleLowConfidenceFallback } from "../handlers/handleMainMenu";
import { handleFreeTextInput } from "../handlers/handleFreeText";
import { goToCheckoutFromCart } from "../handlers/handleCheckout";
import { validateCartItems } from "../services/dbService";

// ─── Mapa step → última pergunta do bot ──────────────────────────────────────

const BOT_QUESTION_BY_STEP: Record<string, string> = {
    checkout_address:              "Qual é o seu endereço de entrega?",
    checkout_payment:              "Como você vai pagar? (PIX, Cartão ou Dinheiro)",
    checkout_confirm:              "Confirme os detalhes do pedido. Digite confirmar para fechar.",
    awaiting_cancel_confirm:       "Tem certeza que quer cancelar o pedido?",
    awaiting_address_number:       "Qual é o número do endereço?",
    awaiting_address_neighborhood: "Qual é o bairro?",
    awaiting_variant_selection:    "Qual variante você prefere? (escolha pelo número)",
    awaiting_address_selection:    "Escolha um endereço salvo ou informe um novo.",
};

const CHECKOUT_HIJACK_STEPS = new Set([
    "checkout_payment",
    "checkout_confirm",
    "awaiting_address_number",
    "awaiting_address_neighborhood",
]);

const SKIP_PARSER_STEPS = new Set([
    "catalog_categories",
    "catalog_products",
    "cart",
    "checkout_address",
    "checkout_payment",
    "checkout_confirm",
    "awaiting_address_number",
    "awaiting_address_neighborhood",
    "awaiting_address_selection",
    "awaiting_split_order",
    "awaiting_variant_selection",
    "awaiting_item_confirmation",
    "awaiting_packaging_selection",
    "done",
    "handover",
]);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[parserChain] Falha ao enviar resposta:", result.error);
    }
}

function resetUnknownCount(session: Session): void {
    session.context.consecutive_unknown_count = 0;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function runParserChain(
    params: ProcessMessageParams,
    session: Session,
    config: CompanyConfig
): Promise<{ handled: boolean }> {
    const { admin, companyId, threadId, messageId, phoneE164 } = params;
    const input       = params.text.trim();
    const companyName = config.name;
    const botConfig   = config.botConfig;

    // ── Add-to-cart hijack em steps de checkout ───────────────────────────────
    if (CHECKOUT_HIJACK_STEPS.has(session.step) && input.length >= 3) {
        const isPayment  = !!detectPaymentMethod(input);
        const isConfirm  = matchesAny(input, ["sim", "não", "nao", "s", "n", "ok", "confirmar", "confirmo", "1", "change_items", "change_address"]);
        const hasAddress = extractAddressFromText(input) !== null;
        if (!isPayment && !isConfirm && !hasAddress) {
            const hijackProducts = await getCachedProducts(admin, companyId);
            const hijackResult   = await parseWithRegex(input, hijackProducts);
            if (hijackResult?.action === "add_to_cart" && (hijackResult.items?.length ?? 0) > 0) {
                const toAdd    = parsedItemsToCartItems(hijackResult.items!);
                const newCart  = mergeCart(session.cart, toAdd);
                const itemList = hijackResult.items!.map((i) => `${i.qty}x ${i.name}`).join(", ");
                resetUnknownCount(session);
                await saveSession(admin, threadId, companyId, { cart: newCart, context: session.context });
                await reply(
                    phoneE164,
                    `✅ Adicionado: ${itemList}!\n\n${formatCart(newCart)}\n\n` +
                    `_Continue ou diga *finalizar* para fechar o pedido._`
                );
                return { handled: true };
            }
        }
    }

    // ── Parser chain principal ────────────────────────────────────────────────
    if (input.length < 3 || SKIP_PARSER_STEPS.has(session.step)) {
        return { handled: false };
    }

    // ── Packaging validation: quantidade + produto → valida em produto_embalagens
    const extracted = extractProductRequests(input);
    if (extracted?.length) {
        const item        = extracted[0];
        const matchResult = await findProductWithPackaging(admin, companyId, item.produto, item.sigla);

        if (matchResult.success) {
            resetUnknownCount(session);

            if (matchResult.unique) {
                // Único resultado → pede confirmação ao cliente
                const match    = matchResult.matches[0];
                const subtotal = item.quantidade * match.preco;
                const volStr   = match.volume ? ` ${match.volume}${match.unidade ?? ""}` : "";

                session.context.pending_item = {
                    quantidade:   item.quantidade,
                    embalagem_id: match.embalagem_id,
                    produto_id:   match.produto_id,
                    produto_nome: match.produto_nome,
                    sigla:        match.sigla,
                    descricao:    match.descricao,
                    volume:       match.volume,
                    unidade:      match.unidade,
                    fator:        match.fator,
                    preco:        match.preco,
                    subtotal,
                };

                await saveSession(admin, threadId, companyId, {
                    context: session.context,
                    step:    "awaiting_item_confirmation",
                });

                await sendInteractiveButtons(
                    phoneE164,
                    `Você pediu:\n\n` +
                    `• *${item.quantidade}x ${match.produto_nome}*` +
                    `${match.descricao ? " " + match.descricao : ""}${volStr}\n` +
                    `• Embalagem: *${match.sigla}* (${match.fator} unid.)\n` +
                    `• Subtotal: *R$ ${subtotal.toFixed(2)}*\n\n` +
                    `Está correto?`,
                    [
                        { id: "confirm_item", title: "✅ Sim, adicionar" },
                        { id: "cancel_item",  title: "❌ Cancelar" },
                    ]
                );
                return { handled: true };
            }

            // Múltiplos resultados → exibe lista interativa
            const listRows = matchResult.matches.slice(0, 10).map((m) => {
                const volStr  = m.volume ? ` ${m.volume}${m.unidade ?? ""}` : "";
                const descStr = m.descricao ? ` - ${m.descricao}` : "";
                return {
                    id:          `pkg_${m.embalagem_id}`,
                    title:       truncateTitle(`${m.sigla}${volStr}`, 24),
                    description: `R$ ${m.preco.toFixed(2)}${descStr}`.slice(0, 72),
                };
            });

            session.context.pending_packaging_selection = {
                quantidade:   item.quantidade,
                produto_nome: matchResult.matches[0].produto_nome,
                options:      matchResult.matches,
            };

            await saveSession(admin, threadId, companyId, {
                context: session.context,
                step:    "awaiting_packaging_selection",
            });

            await sendListMessage(
                phoneE164,
                `Encontrei *${matchResult.matches.length} opções* de ` +
                `${matchResult.matches[0].produto_nome}.\n\nQual embalagem você quer?`,
                "Ver opções",
                listRows,
                "Embalagens Disponíveis"
            );
            return { handled: true };
        }
        // matchResult.success === false → produto não encontrado → cai no parser chain
    }

    const products      = await getCachedProducts(admin, companyId);
    const aiInput       = cleanInputForAI(input);
    const cartSummary   = session.cart.length > 0
        ? session.cart.map((i) => `${i.qty}x ${i.name}`).join(", ")
        : "";
    const lastBotQuestion =
        BOT_QUESTION_BY_STEP[session.step] ??
        (session.context.last_bot_question as string | undefined) ??
        "";
    const lastIntent    = (session.context.last_intent as string | undefined) ?? "";

    const parsed = await parseWithFactory({
        admin,
        companyId,
        threadId,
        messageId,
        input:           aiInput,
        products,
        step:            session.step,
        cartSummary,
        lastBotQuestion: lastBotQuestion || undefined,
        lastIntent:      lastIntent      || undefined,
        claudeConfig: {
            model:      String(botConfig.model     ?? "claude-haiku-4-5-20251001"),
            threshold:  Number(botConfig.threshold  ?? 0.75),
            maxRetries: 1,
            timeoutMs:  4000,
        },
    });

    // Persiste a intenção classificada para a próxima rodada
    const detectedIntentNow = (parsed as { _intent?: string })._intent;
    if (detectedIntentNow) {
        session.context.last_intent = detectedIntentNow;
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, last_intent: detectedIntentNow },
        });
    }

    const detectedIntent = (parsed as { _intent?: MessageIntent })._intent;

    // ── product_question ──────────────────────────────────────────────────────
    if (detectedIntent === "product_question") {
        const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
        if (ftResult === "handled") return { handled: true };

        const question = (parsed as { message?: string }).message ?? input;
        const terms    = question.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3);
        const match    = products.find((p) =>
            terms.some((t: string) =>
                p.productName.toLowerCase().includes(t) ||
                (p.details ?? "").toLowerCase().includes(t) ||
                (p.tags    ?? "").toLowerCase().includes(t)
            )
        );
        if (match) {
            const priceStr = match.unitPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            await saveSession(admin, threadId, companyId, {
                step: "catalog_products",
                context: {
                    ...session.context,
                    pending_variant: {
                        variantId:   match.id,
                        productName: match.productName,
                        details:     match.details ?? "",
                        unitPrice:   match.unitPrice,
                    },
                },
            });
            await reply(
                phoneE164,
                `Temos *${match.productName}${match.details ? " " + match.details : ""}* por ${priceStr}.\n\n` +
                `Quantas unidades você quer? 🛒`
            );
        } else {
            await reply(
                phoneE164,
                `Não encontrei *${question}* no catálogo agora. 😔\n\n` +
                `Posso te mostrar o cardápio completo? Digite *cardápio* ou escolha uma categoria.`
            );
        }
        return { handled: true };
    }

    // ── order_status ──────────────────────────────────────────────────────────
    if (detectedIntent === "order_status") {
        await replyWithOrderStatus(admin, companyId, phoneE164);
        return { handled: true };
    }

    // ── chitchat ──────────────────────────────────────────────────────────────
    if (detectedIntent === "chitchat") {
        if (session.step === "main_menu" || session.step === "welcome" || !session.step) {
            await sendInteractiveButtons(
                phoneE164,
                `Como posso te ajudar no *${companyName}*? 🍺`,
                [
                    { id: "1", title: "🍺 Ver cardápio" },
                    { id: "2", title: "📦 Meu pedido" },
                    { id: "3", title: "🙋 Falar c/ atendente" },
                ]
            );
            return { handled: true };
        }
        // Em outros steps: deixa o step router tratar
        return { handled: false };
    }

    // ── add_to_cart ───────────────────────────────────────────────────────────
    if (parsed.action === "add_to_cart" && parsed.items.length > 0) {
        // Redireciona para seleção de variante quando múltiplas do mesmo produto existem
        if (!hasVolumeClue(input) && parsed.items.length === 1) {
            const extractBaseName = (name: string) =>
                name.toLowerCase()
                    .replace(/\d+(?:[.,]\d+)?\s*(?:ml|l|litros?|cl|g|kg)\b/gi, "")
                    .replace(/\s+/g, " ").trim();
            const baseName  = extractBaseName(parsed.items[0].name);
            const siblings  = products.filter(
                (p) => extractBaseName(p.productName) === baseName
            );
            if (siblings.length > 1) {
                const ftResult = await handleFreeTextInput(
                    admin, companyId, threadId, phoneE164, parsed.items[0].name, session
                );
                if (ftResult === "handled") return { handled: true };
            }
        }

        // Validação pós-parse: confirma existência no DB antes de adicionar ao carrinho
        const { valid: validItems, rejected } = await validateCartItems(admin, companyId, parsed.items);
        if (rejected.length > 0) {
            await reply(phoneE164, `Não encontrei: ${rejected.join(", ")}. Adicionei o restante ao carrinho.`);
        }
        if (validItems.length === 0) return { handled: true };

        const toAdd   = parsedItemsToCartItems(validItems);
        const newCart = mergeCart(session.cart, toAdd);
        const ctx: Record<string, unknown> = { ...session.context, consecutive_unknown_count: 0 };

        if (parsed.contextUpdate?.delivery_address) {
            const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
            const zone         = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
            Object.assign(ctx, parsed.contextUpdate, {
                delivery_fee:     zone?.fee ?? ctx.delivery_fee,
                delivery_zone_id: zone?.id  ?? ctx.delivery_zone_id,
            });
        } else {
            Object.assign(ctx, parsed.contextUpdate);
        }

        const detectedPm = detectPaymentMethod(input);
        if (detectedPm && !ctx.payment_method) {
            ctx.payment_method = detectedPm;
        }

        await saveSession(admin, threadId, companyId, { cart: newCart, context: ctx });

        if (ctx.delivery_address && ctx.payment_method) {
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, cart: newCart, context: ctx });
            return { handled: true };
        }

        const stepLabels: Record<string, string> = {
            main_menu: "menu", catalog_categories: "categorias", catalog_products: "catálogo",
            cart: "carrinho", checkout_address: "endereço", checkout_payment: "pagamento",
            checkout_confirm: "confirmação",
        };
        const stepLabel = stepLabels[session.step] ?? "pedido";
        const itemList  = validItems.map((i) => `${i.qty}x ${i.name}`).join(", ");
        await reply(
            phoneE164,
            `✅ Adicionado ${itemList}!\n\nSeu pedido agora tem *${newCart.length}* itens.\n\n` +
            `Podemos continuar com *${stepLabel}* ou quer algo mais?`
        );
        return { handled: true };
    }

    if (parsed.action === "add_to_cart" && parsed.items.length === 0 && parsed.contextUpdate?.delivery_address) {
        const rawAddr      = parsed.contextUpdate.delivery_address as string;
        const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
        const zone         = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
        const ctx: Record<string, unknown> = {
            ...session.context,
            ...parsed.contextUpdate,
            delivery_fee:              zone?.fee ?? null,
            delivery_zone_id:          zone?.id  ?? null,
            consecutive_unknown_count: 0,
        };

        if (session.cart.length > 0) {
            await saveSession(admin, threadId, companyId, { context: ctx });
            await reply(
                phoneE164,
                `📍 Entrega para *${rawAddr}*.\n\n` +
                `${formatCart(session.cart)}\n\nQual a forma de pagamento? 💳`
            );
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, context: ctx });
        } else {
            await saveSession(admin, threadId, companyId, { context: ctx, step: "main_menu" });
            await reply(
                phoneE164,
                `Endereço anotado: *${rawAddr}* 📍\n\nAgora me diga o que você quer pedir! 🍺`
            );
        }
        return { handled: true };
    }

    // ── confirm_order ─────────────────────────────────────────────────────────
    if (parsed.action === "confirm_order") {
        const toAdd        = parsedItemsToCartItems(parsed.items);
        const newCart      = mergeCart(session.cart, toAdd);
        const neighborhood = parsed.address?.neighborhood ?? null;
        const zone         = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
        const ctx: Record<string, unknown> = {
            ...session.context,
            ...parsed.contextUpdate,
            delivery_fee:              zone?.fee ?? null,
            delivery_zone_id:          zone?.id  ?? null,
            consecutive_unknown_count: 0,
        };
        await saveSession(admin, threadId, companyId, { cart: newCart, context: ctx });
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, cart: newCart, context: ctx });
        return { handled: true };
    }

    // ── Prioridade de endereço em low_confidence / product_not_found ──────────
    if (
        (parsed.action === "low_confidence" || parsed.action === "product_not_found") &&
        parsed.contextUpdate?.delivery_address
    ) {
        const neighborhood = (parsed.contextUpdate.delivery_neighborhood as string) ?? null;
        const zone         = neighborhood ? await findDeliveryZone(admin, companyId, neighborhood) : null;
        const addrCtx: Record<string, unknown> = {
            ...session.context,
            ...parsed.contextUpdate,
            delivery_fee:              zone?.fee ?? null,
            delivery_zone_id:          zone?.id  ?? null,
            consecutive_unknown_count: 0,
        };

        await saveSession(admin, threadId, companyId, { context: addrCtx });

        if (session.cart.length > 0) {
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, { ...session, context: addrCtx });
            return { handled: true };
        }

        const addrMatch    = extractAddressFromText(input);
        const cleanedInput = addrMatch ? input.replace(addrMatch.rawSlice, " ").trim() : input;
        const ftResult     = await handleFreeTextInput(
            admin, companyId, threadId, phoneE164, cleanedInput, { ...session, context: addrCtx }
        );
        if (ftResult === "handled") return { handled: true };
    }

    // ── low_confidence fallback ───────────────────────────────────────────────
    if (parsed.action === "low_confidence") {
        const FREE_TEXT_STEPS = ["main_menu", "welcome", "cart"];
        if (!FREE_TEXT_STEPS.includes(session.step)) {
            const fallbackProducts = await getCachedProducts(admin, companyId);
            const didFallback = await handleLowConfidenceFallback(
                admin, companyId, threadId, phoneE164, companyName, session, input, fallbackProducts
            );
            if (didFallback) return { handled: true };
        }
    }

    return { handled: false };
}
