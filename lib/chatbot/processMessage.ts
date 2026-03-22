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
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage } from "../whatsapp/send";
import { getCachedProducts } from "./TextParserService";
import { parsedItemsToCartItems } from "./OrderParserService";
import { parseWithFactory } from "./parsers/ParserFactory";
import type { MessageIntent } from "./parsers/ClaudeParser";
import { parseWithRegex } from "./parsers/RegexParser";
export type { DisplayableVariant } from "./displayHelpers";

// ─── Tipos re-exportados ──────────────────────────────────────────────────────

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";

// ─── Imports de módulos ───────────────────────────────────────────────────────

import type { ProcessMessageParams, Session } from "./types";
import { getOrCreateSession, saveSession } from "./session";
import {
    normalize, matchesAny, formatCart, formatCurrency,
    mergeCart, buildMainMenu, STOPWORDS,
} from "./utils";
import {
    extractAddressFromText, detectMultipleAddresses, extractClientName,
    detectRemoveIntent, detectPaymentMethod, cleanInputForAI,
} from "./textParsers";
import { getCompanyInfo } from "./db/company";
import { getCategories, findDeliveryZone } from "./db/variants";
import { replyWithOrderStatus } from "./db/orders";
import { handleMainMenu, handleLowConfidenceFallback, doHandover } from "./handlers/handleMainMenu";
import {
    handleCatalogCategories, handleCatalogProducts,
} from "./handlers/handleCatalog";
import { handleCart, goToCart } from "./handlers/handleCart";
import {
    goToCheckoutFromCart, handleAwaitingAddressSelection, handleCheckoutAddress,
    handleCheckoutPayment, handleCheckoutConfirm,
    handleAwaitingVariantSelection, handleAwaitingSplitOrder,
} from "./handlers/handleCheckout";
import { handleAwaitingAddressNumber, handleAwaitingAddressNeighborhood } from "./handlers/handleAddress";
import { handleFreeTextInput } from "./handlers/handleFreeText";

// ─── Helper de envio ──────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── Regex Layer 1 ────────────────────────────────────────────────────────────

/** Saudações puras — sem nenhum conteúdo de produto junto */
const GREETING_ONLY_RE = /^(bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|tudo\s+bom|como\s+vai|como\s+voce|feliz\s+ano|feliz\s+natal|obrigad[oa]|obg|valeu|vlw|tchau|ate\s+mais)\s*[!?.,]?\s*$/iu;

/** Consulta de status/localização do pedido */
const ORDER_STATUS_RE = /(?:(?<!\w)cad[eê](?!\w)|onde\s+est[aá]\b|onde\s+ficou\b|\bstatus\s+d[oe]\s+pedido\b|\bmeu\s+pedido\b|\bacompanhar\s+pedido\b|\bquanto\s+tempo\s+(?:falta|vai|leva)\b|\bprevis[aã]o\s+de\s+entrega\b)/iu;

// ─── Regex de módulo (evita recriação por chamada) ────────────────────────────
const REMOVE_VERBS_RE      = /\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/giu;
const CANCELAR_TEST_RE     = /\b(cancelar|cancela)\b/iu;
const CANCELAR_STRIP_RE    = /\b(cancelar|cancela)\b/giu;
const AWAIT_CANCEL_YES_RE  = /(?<![a-záàâãéèêíïóôõúüç])\b(sim|yes|pode|confirm|cancela|cancelo)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AWAIT_CANCEL_NO_RE   = /(?<![a-záàâãéèêíïóôõúüç])\b(nao|não|no|nope|voltar|continuar|nao\s+quero)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AFFIRMATIVE_RE       = /\b(sim|yes|continuar|continue|blz|ok|pode|beleza|top|certo|perfeito|exato|claro|positivo|vai|bora|isso|manda|confirmar)\b/iu;

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, messageId, phoneE164, text, profileName } = params;

    const input = text.trim();
    if (!input) return;

    // Verifica se existe bot ativo para esta empresa e carrega config
    const { data: botRows } = await admin
        .from("chatbots")
        .select("id, config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

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

    // ── 1. Global reset (menu/oi/ola/reiniciar — WITHOUT cancelar) ───────────
    if (matchesAny(input, ["limpar", "reiniciar", "menu", "inicio", "comecar", "oi", "ola", "hello", "hi", "esvaziar"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await sendInteractiveButtons(
            phoneE164,
            `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nVocê pode digitar o que precisa que já vejo pra você.`,
            [
                { id: "1", title: "🍺 Ver cardápio" },
                { id: "2", title: "📦 Meu pedido" },
                { id: "3", title: "🙋 Falar c/ atendente" },
            ]
        );
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
        const withoutVerb = normIn.replace(REMOVE_VERBS_RE, "").trim();
        const removeTerms = withoutVerb.split(/\s+/u).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
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
    const isCancelarInput = CANCELAR_TEST_RE.test(input);
    if (isCancelarInput) {
        const normIn = normalize(input);
        const withoutCancel = normIn.replace(CANCELAR_STRIP_RE, "").trim();
        const cancelTerms = withoutCancel.split(/\s+/u).filter((w) => w.length >= 2 && !STOPWORDS.has(w));

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
        const isYes = AWAIT_CANCEL_YES_RE.test(normalize(input));
        const isNo  = AWAIT_CANCEL_NO_RE.test(normalize(input));
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
        const isAffirmative = AFFIRMATIVE_RE.test(input);
        if (isAffirmative && session.step === "checkout_confirm") {
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, "confirmar", session);
            return;
        }
    }

    // ── 8. Checkout keywords ──────────────────────────────────────────────────
    const CHECKOUT_KEYWORDS = ["fechar pedido","fechar","pagar","finalizar","acabou","checkout","quero pagar","fecha","bater caixa","vou pagar","quero finalizar","vou finalizar","pode fechar","fecha ai","bater o caixa","quero fechar","encerrar","terminar","quero confirmar"];
    if (matchesAny(input, CHECKOUT_KEYWORDS) && session.cart.length > 0) {
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

    // ── 10.5. Layer 1 — Regex quick-resolve (zero tokens de IA) ─────────────
    // Saudações puras → responde menu sem acionar Claude
    if (GREETING_ONLY_RE.test(input)) {
        await reply(phoneE164, `Olá! 😊 ${buildMainMenu(companyName)}`);
        return;
    }
    // Consulta de status → busca direta no banco, sem Claude
    if (ORDER_STATUS_RE.test(input)) {
        await replyWithOrderStatus(admin, companyId, phoneE164);
        return;
    }

    // ── 11. Interceptor global: ParserFactory (Claude→Regex→Assisted) ─────────
    // Toda mensagem passa primeiro pelo parser; produtos são adicionados (merge), endereço validado com Google

    // ── 11b. Add-to-cart hijack em steps de checkout ─────────────────────────────
    // Permite adicionar produto por texto livre mesmo durante checkout/pagamento/confirmação,
    // usando apenas o Regex parser (rápido, sem Claude) para não esgotar o timeout de 10s.
    const CHECKOUT_HIJACK_STEPS = new Set([
        "checkout_payment",
        "checkout_confirm",
        "awaiting_address_number",
        "awaiting_address_neighborhood",
    ]);
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
                await saveSession(admin, threadId, companyId, { cart: newCart });
                await reply(
                    phoneE164,
                    `✅ Adicionado: ${itemList}!\n\n${formatCart(newCart)}\n\n` +
                    `_Continue ou diga *finalizar* para fechar o pedido._`
                );
                return;
            }
        }
    }

    const SKIP_PARSER_STEPS = new Set([
        "checkout_payment",
        "checkout_confirm",
        "awaiting_address_number",
        "awaiting_address_neighborhood",
        "awaiting_address_selection",
        "awaiting_split_order",
        "awaiting_variant_selection",
        "done",
        "handover",
    ]);
    if (input.length >= 3 && !SKIP_PARSER_STEPS.has(session.step)) {
        const products = await getCachedProducts(admin, companyId);
        const aiInput = cleanInputForAI(input); // Layer 2: remove ruídos antes de enviar à IA
        const cartSummary = session.cart.length > 0
            ? session.cart.map((i) => `${i.qty}x ${i.name}`).join(", ")
            : "";
        const parsed = await parseWithFactory({
            admin,
            companyId,
            threadId,
            messageId,
            input: aiInput,
            products,
            step: session.step,
            cartSummary,
            claudeConfig: {
                model:      String(botConfig.model    ?? "claude-haiku-4-5-20251001"),
                threshold:  Number(botConfig.threshold ?? 0.75),
                maxRetries: 1,    // nunca retry em serverless — Vercel tem limite de 10s
                timeoutMs:  4000, // 4s max → sobra ~6s para DB, Maps e envio da resposta
            },
        });

        // ── Intent não-order detectada pelo Claude ──────────────────────────
        const detectedIntent = (parsed as any)._intent as MessageIntent | undefined;

        if (detectedIntent === "product_question") {
            // Tenta responder a dúvida do produto consultando o catálogo
            const question = (parsed as any).message as string | undefined ?? input;
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
                await reply(
                    phoneE164,
                    `Temos *${match.productName}${match.details ? " " + match.details : ""}* por ${priceStr}.\n\n` +
                    `Quer adicionar ao pedido? Basta dizer a quantidade! 🛒`
                );
            } else {
                await reply(
                    phoneE164,
                    `Não encontrei *${question}* no catálogo agora. 😔\n\n` +
                    `Posso te mostrar o cardápio completo? Digite *cardápio* ou escolha uma categoria.`
                );
            }
            return;
        }

        if (detectedIntent === "order_status") {
            await replyWithOrderStatus(admin, companyId, phoneE164);
            return;
        }

        if (detectedIntent === "chitchat") {
            // Saudação / agradecimento / conversa aleatória — responde e mostra o menu
            await reply(phoneE164, `Olá! 😊 Estou aqui para ajudar com seus pedidos.\n\n${buildMainMenu(companyName)}`);
            return;
        }

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
                const fallbackProducts = await getCachedProducts(admin, companyId);
                const didFallback = await handleLowConfidenceFallback(
                    admin, companyId, threadId, phoneE164, companyName, session, input, fallbackProducts
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
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, input, session, goToCheckoutFromCart, goToCart);
            break;

        case "catalog_variant":
            // Legado: redireciona para catalog_products
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, input, session, goToCheckoutFromCart, goToCart);
            break;

        case "cart":
            await handleCart(admin, companyId, threadId, phoneE164, companyName, input, session, goToCheckoutFromCart);
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

        case "awaiting_address_selection":
            await handleAwaitingAddressSelection(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "awaiting_flow":
            // Flow aberto — aguardando submissão do formulário nativo
            // Ignora mensagens de texto até o Flow ser submetido ou expirar
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
