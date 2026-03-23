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
    mergeCart, STOPWORDS,
} from "./utils";
import {
    extractAddressFromText, detectMultipleAddresses, extractClientName,
    detectRemoveIntent, detectPaymentMethod, cleanInputForAI, hasVolumeClue,
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

// ─── Mapa step → última pergunta do bot ──────────────────────────────────────
//
// Usado para injetar "Última pergunta do bot" no prompt do ClaudeParser,
// ancorando a interpretação do próximo input do cliente.
// Ex: step=checkout_payment → Claude sabe que a resposta provavelmente é um método de pagamento.

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

// ─── Arbitragem de intenção (Features 2, 3, 4) ────────────────────────────────

/**
 * Feature 3 — Filtro de Negação para cancelamento.
 * "não quero cancelar", "nem cancelar", "jamais cancelar" → NÃO é intenção de cancelar.
 * Janela de 25 chars entre negação e "cancelar" cobre construções naturais em PT-BR.
 */
const NEGATION_CANCEL_RE = /\b(nao|não|nem|nunca|jamais)\b.{0,25}\b(cancelar|cancela)\b/iu;

/**
 * Feature 3 — Negação genérica que invalida AFFIRMATIVE_RE em intenções críticas.
 * Detecta "não", "nao", "nem", "nunca", "jamais", "de jeito nenhum".
 */
const NEGATION_RE = /\b(nao|não|nem|nunca|jamais|de\s+jeito\s+nenhum)\b/iu;

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

    // ── 1. Global reset ───────────────────────────────────────────────────────
    // Dois comportamentos distintos:
    // a) Reset EXPLÍCITO (limpar/reiniciar/esvaziar): apaga carrinho sempre
    // b) Navegação (oi/ola/menu/inicio): preserva carrinho se tiver itens
    const EXPLICIT_RESET_RE = /\b(?:limpar|reiniciar|esvaziar|comecar)\b/iu;
    const NAV_RESET_RE      = /\b(?:menu|inicio|oi|ola|hello|hi)\b/iu;
    const normInput = normalize(input);

    if (EXPLICIT_RESET_RE.test(normInput)) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await sendInteractiveButtons(
            phoneE164,
            `Como posso te ajudar no *${companyName}*? 🍺`,
            [
                { id: "1", title: "🍺 Ver cardápio" },
                { id: "2", title: "📦 Meu pedido" },
                { id: "3", title: "🙋 Falar c/ atendente" },
            ]
        );
        return;
    }

    if (NAV_RESET_RE.test(normInput)) {
        if (session.cart.length > 0) {
            // Tem carrinho: mostra menu mas PRESERVA carrinho e contexto
            await saveSession(admin, threadId, companyId, { step: "main_menu" });
            await sendInteractiveButtons(
                phoneE164,
                `Como posso te ajudar no *${companyName}*? 🍺\n\n_Seu carrinho foi mantido (${session.cart.length} ${session.cart.length === 1 ? "item" : "itens"})._`,
                [
                    { id: "1", title: "🍺 Ver cardápio" },
                    { id: "2", title: "📦 Meu pedido" },
                    { id: "3", title: "🙋 Falar c/ atendente" },
                ]
            );
        } else {
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await sendInteractiveButtons(
                phoneE164,
                `Como posso te ajudar no *${companyName}*? 🍺`,
                [
                    { id: "1", title: "🍺 Ver cardápio" },
                    { id: "2", title: "📦 Meu pedido" },
                    { id: "3", title: "🙋 Falar c/ atendente" },
                ]
            );
        }
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
    //
    // Feature 3 (Filtro de Negação — contexto-consciente):
    //   "não quero cancelar" → NÃO é intenção de cancelar (negação explícita).
    //   "não, cancela" quando bot perguntou "Qual seu endereço?" → É cancelamento!
    //     (o "não" está respondendo a pergunta do bot, não negando o cancel.)
    //   Regra: NEGATION_CANCEL_RE só suprime cancel quando o bot NÃO está esperando
    //   uma resposta que naturalmente pode ser "não" (ex: endereço, pagamento, variante).
    const CANCEL_UNRELATED_QUESTION_STEPS = new Set([
        "checkout_payment",
        "checkout_address",
        "awaiting_address_number",
        "awaiting_address_neighborhood",
        "awaiting_address_selection",
        "awaiting_variant_selection",
    ]);
    const botHasOpenQuestion      = CANCEL_UNRELATED_QUESTION_STEPS.has(session.step);
    const negationSuppressesCancel = NEGATION_CANCEL_RE.test(input) && !botHasOpenQuestion;
    const isCancelarInput          = CANCELAR_TEST_RE.test(input) && !negationSuppressesCancel;
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
            await sendInteractiveButtons(
                phoneE164,
                `✅ Pedido cancelado. Como posso te ajudar no *${companyName}*?`,
                [
                    { id: "1", title: "🍺 Ver cardápio" },
                    { id: "2", title: "📦 Meu pedido" },
                    { id: "3", title: "🙋 Falar c/ atendente" },
                ]
            );
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
    //
    // Feature 2 (Confiança Restrita): só confirma diretamente se frase é curta (≤ 4 palavras).
    // Feature 3 (Filtro de Negação):  se a mensagem contém negação, não trata como confirmação.
    // Feature 4 (Fallback):           frase longa + sem negação → pergunta "é isso?" com botões.
    {
        const isAffirmative = AFFIRMATIVE_RE.test(input);
        if (isAffirmative && session.step === "checkout_confirm") {
            const hasNegation = NEGATION_RE.test(input);
            const wordCount   = input.trim().split(/\s+/u).length;

            if (hasNegation) {
                // Negação presente: "não, pode não", "não confirma" → não é confirmação.
                // Deixa o switch (linha abaixo) chamar handleCheckoutConfirm com o input
                // original; lá, se não reconhecer, reexibe o resumo do pedido.
            } else if (wordCount <= 4) {
                // Alta confiança: frase curta e sem negação ("sim", "ok", "pode confirmar").
                await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, "confirmar", session);
                return;
            } else {
                // Baixa confiança: frase longa com palavra afirmativa ("ok mas antes, muda o endereço").
                // Feature 4: pede confirmação explícita via botões em vez de processar direto.
                await sendInteractiveButtons(
                    phoneE164,
                    `Entendi que você quer *confirmar o pedido*, é isso?`,
                    [
                        { id: "confirmar",    title: "✅ Sim, confirmar" },
                        { id: "change_items", title: "✏️ Não, alterar" },
                    ]
                );
                return;
            }
        }
    }

    // ── 8. Checkout keywords ──────────────────────────────────────────────────
    const CHECKOUT_KEYWORDS = [
        "fechar pedido","fechar","pagar","finalizar","acabou","checkout","quero pagar","fecha",
        "bater caixa","vou pagar","quero finalizar","vou finalizar","pode fechar","fecha ai",
        "bater o caixa","quero fechar","encerrar","terminar","quero confirmar",
        // Gírias negativas / "chega, era só isso"
        "nao quero mais","nao quero mais nada","era so isso","so isso mesmo",
        "chega por hoje","chega por ora","nao preciso mais","era isso ai","mais nao","nao mais",
        "pronto pode fechar","ta bom assim","to bom assim","isso e tudo","e so isso",
    ];
    if (matchesAny(input, CHECKOUT_KEYWORDS) && session.cart.length > 0) {
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    // ── 8b. Global NEGATIVE/POSITIVE response (qualquer step com carrinho) ────
    // Evita que "não obrigado" e similares fiquem sem resposta em qualquer step
    const CHECKOUT_PROTECTED_STEPS = new Set([
        "checkout_address", "awaiting_address_number", "awaiting_address_neighborhood",
        "awaiting_address_selection", "checkout_payment", "checkout_confirm",
        "awaiting_cancel_confirm", "awaiting_split_order",
    ]);
    if (session.cart.length > 0 && !CHECKOUT_PROTECTED_STEPS.has(session.step)) {
        const normIn = normalize(input);
        const GLOBAL_NEGATIVE_RE = /^(nao|nop[es]?|nah|chega(?:u)?|ta\s+bom|to\s+bom|blz|beleza|so\s+isso|era\s+so\s+isso|isso\s+mesmo|era\s+isso|fechou|prontinho|ja\s+basta|nao\s+obrigad[oa]|nao\s+preciso|nao\s+quero\s+mais|ja\s+e\s+suficiente|pode\s+fechar|fecha\s+ai|e\s+so\s+isso|e\s+tudo)$/iu;
        const GLOBAL_POSITIVE_RE  = /^(sim|bora|vamos|claro|top|quero\s+mais|ver\s+mais|me\s+mostra\s+mais|tem\s+mais|mostra\s+mais)$/iu;

        if (GLOBAL_NEGATIVE_RE.test(normIn)) {
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
            return;
        }
        if (GLOBAL_POSITIVE_RE.test(normIn)) {
            const categories = await getCategories(admin, companyId);
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
    // Saudações puras → só responde no menu/welcome; em outros steps preserva o contexto.
    const GREETING_ALLOWED_STEPS = new Set(["main_menu", "welcome", ""]);
    if (GREETING_ONLY_RE.test(input) && GREETING_ALLOWED_STEPS.has(session.step)) {
        await sendInteractiveButtons(
            phoneE164,
            `Como posso te ajudar no *${companyName}*? 🍺`,
            [
                { id: "1", title: "🍺 Ver cardápio" },
                { id: "2", title: "📦 Meu pedido" },
                { id: "3", title: "🙋 Falar c/ atendente" },
            ]
        );
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
        // Steps de catálogo: têm handlers próprios completos, parser global interfere
        "catalog_categories",
        "catalog_products",
        "cart",
        // Steps de endereço: handleCheckoutAddress e helpers já fazem validação completa
        "checkout_address",
        // Steps de checkout: não esperam pedidos de produto
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

        // Deriva a última pergunta do bot pelo step atual; fallback para o contexto salvo.
        const lastBotQuestion =
            BOT_QUESTION_BY_STEP[session.step] ??
            (session.context.last_bot_question as string | undefined) ??
            "";
        const lastIntent = (session.context.last_intent as string | undefined) ?? "";

        const parsed = await parseWithFactory({
            admin,
            companyId,
            threadId,
            messageId,
            input: aiInput,
            products,
            step:            session.step,
            cartSummary,
            lastBotQuestion: lastBotQuestion || undefined,
            lastIntent:      lastIntent      || undefined,
            claudeConfig: {
                model:      String(botConfig.model    ?? "claude-haiku-4-5-20251001"),
                threshold:  Number(botConfig.threshold ?? 0.75),
                maxRetries: 1,    // nunca retry em serverless — Vercel tem limite de 10s
                timeoutMs:  4000, // 4s max → sobra ~6s para DB, Maps e envio da resposta
            },
        });

        // Persiste a intenção classificada para a próxima rodada (fire-and-forget).
        // Não aguardamos para não bloquear o tempo de resposta.
        const detectedIntentNow = (parsed as any)._intent as string | undefined;
        if (detectedIntentNow) {
            session.context.last_intent = detectedIntentNow; // em memória para uso imediato
            saveSession(admin, threadId, companyId, {
                context: { ...session.context, last_intent: detectedIntentNow },
            }).catch(() => {});
        }

        // ── Intent não-order detectada pelo Claude ──────────────────────────
        const detectedIntent = (parsed as any)._intent as MessageIntent | undefined;

        if (detectedIntent === "product_question") {
            // Rota pelo handleFreeTextInput: salva step=catalog_products + pending_variant
            // para que o próximo input do cliente (ex: "2" = quantidade) seja tratado
            // no contexto correto, evitando que "2" seja interpretado como opção do menu.
            const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
            if (ftResult === "handled") return;

            // handleFreeTextInput não conseguiu resolver (skip/notfound) → responde diretamente
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
                // Salva pending_variant + step=catalog_products para que o próximo input
                // (ex: "2" = quantidade) seja tratado no contexto correto.
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
            return;
        }

        if (detectedIntent === "order_status") {
            await replyWithOrderStatus(admin, companyId, phoneE164);
            return;
        }

        if (detectedIntent === "chitchat") {
            // Saudação/agradecimento apenas no menu/welcome — em outros steps preserva o fluxo.
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
                return;
            }
            // Outros steps: ignora o chitchat e deixa o switch tratar o step atual
        }

        if (parsed.action === "add_to_cart" && parsed.items.length > 0) {
            // Fix 5: se o usuário não especificou volume e existem múltiplas variantes do
            // mesmo produto base no catálogo → redireciona para seleção de variante
            if (!hasVolumeClue(input) && parsed.items.length === 1) {
                const extractBaseName = (name: string) =>
                    name.toLowerCase()
                        .replace(/\d+(?:[.,]\d+)?\s*(?:ml|l|litros?|cl|g|kg)\b/gi, "")
                        .replace(/\s+/g, " ").trim();
                const baseName = extractBaseName(parsed.items[0].name);
                const siblings = products.filter(
                    (p) => extractBaseName(p.productName) === baseName
                );
                if (siblings.length > 1) {
                    const ftResult = await handleFreeTextInput(
                        admin, companyId, threadId, phoneE164, parsed.items[0].name, session
                    );
                    if (ftResult === "handled") return;
                }
            }

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
            const FREE_TEXT_STEPS = ["main_menu", "welcome", "cart"];
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

        case "catalog_products":
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

        case "awaiting_flow": {
            // Flow aberto — mas NÃO silencia o cliente
            const FLOW_ESCAPE_RE = /\b(?:cancelar|sair|voltar|menu|oi|ola)\b/iu;
            const flowStartedAt  = session.context.flow_started_at as string | undefined;
            const flowExpired    = flowStartedAt
                ? Date.now() - new Date(flowStartedAt).getTime() > 30 * 60 * 1000
                : false;

            if (FLOW_ESCAPE_RE.test(normalize(input)) || flowExpired) {
                // Volta para seleção de endereço preservando carrinho
                await saveSession(admin, threadId, companyId, {
                    step:    "main_menu",
                    context: { ...session.context, flow_token: undefined, flow_started_at: undefined },
                });
                await sendInteractiveButtons(
                    phoneE164,
                    `Formulário cancelado. Seu carrinho foi mantido! 😊\n\nComo posso te ajudar?`,
                    [
                        { id: "1", title: "🍺 Ver cardápio" },
                        { id: "finalizar", title: "Finalizar pedido" },
                        { id: "3", title: "🙋 Falar c/ atendente" },
                    ]
                );
            } else {
                // Qualquer outra mensagem — orienta sem engolir
                await reply(
                    phoneE164,
                    `Você tem um formulário de endereço aberto. Preencha-o pelo botão acima ou diga *cancelar* para voltar. 😊`
                );
            }
            break;
        }

        case "handover":
            // Bot silenciado — humano está atendendo
            break;

        case "done":
            // Pedido confirmado → reset e trata a nova mensagem como main_menu
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, { ...session, step: "main_menu", cart: [], context: {} }, profileName);
            break;

        default:
            // Step desconhecido → reset silencioso e trata como main_menu
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, { ...session, step: "main_menu", cart: [], context: {} }, profileName);
    }
}
