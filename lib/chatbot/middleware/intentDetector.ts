/**
 * lib/chatbot/middleware/intentDetector.ts
 *
 * Detecta e trata intenções globais antes do parser chain:
 * reset, handover, nome do cliente, remover item, cancelar,
 * awaiting_cancel_confirm, afirmativo/negativo global, checkout keywords,
 * saudações e status do pedido.
 *
 * Retorna { handled: true } quando a mensagem foi totalmente processada
 * e processMessage deve encerrar. { handled: false } caso contrário.
 */

import type { Session, CompanyConfig } from "../types";
import type { ProcessMessageParams } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";
import { sendInteractiveButtons, sendListMessage } from "../../whatsapp/send";
import {
    normalize, matchesAny, formatCart, STOPWORDS,
} from "../utils";
import {
    extractClientName, detectRemoveIntent, detectPaymentMethod,
    detectMultipleAddresses,
} from "../textParsers";
import { getCategories } from "../db/variants";
import { replyWithOrderStatus } from "../db/orders";
import { doHandover } from "../handlers/handleMainMenu";
import {
    goToCheckoutFromCart, handleCheckoutPayment, handleCheckoutConfirm,
} from "../handlers/handleCheckout";

// ─── Regex ────────────────────────────────────────────────────────────────────

const EXPLICIT_RESET_RE    = /\b(?:limpar|reiniciar|esvaziar|comecar)\b/iu;
const NAV_RESET_RE         = /\b(?:menu|inicio|oi|ola|hello|hi)\b/iu;
const REMOVE_VERBS_RE      = /\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/giu;
const CANCELAR_TEST_RE     = /\b(cancelar|cancela)\b/iu;
const CANCELAR_STRIP_RE    = /\b(cancelar|cancela)\b/giu;
const AWAIT_CANCEL_YES_RE  = /(?<![a-záàâãéèêíïóôõúüç])\b(sim|yes|pode|confirm|cancela|cancelo)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AWAIT_CANCEL_NO_RE   = /(?<![a-záàâãéèêíïóôõúüç])\b(nao|não|no|nope|voltar|continuar|nao\s+quero)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AFFIRMATIVE_RE       = /\b(sim|yes|continuar|continue|blz|ok|pode|beleza|top|certo|perfeito|exato|claro|positivo|vai|bora|isso|manda|confirmar)\b/iu;
const NEGATION_CANCEL_RE   = /\b(nao|não|nem|nunca|jamais)\b.{0,25}\b(cancelar|cancela)\b/iu;
const NEGATION_RE          = /\b(nao|não|nem|nunca|jamais|de\s+jeito\s+nenhum)\b/iu;
const GREETING_ONLY_RE     = /^(bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|tudo\s+bom|como\s+vai|como\s+voce|feliz\s+ano|feliz\s+natal|obrigad[oa]|obg|valeu|vlw|tchau|ate\s+mais)\s*[!?.,]?\s*$/iu;
const ORDER_STATUS_RE      = /(?:(?<!\w)cad[eê](?!\w)|onde\s+est[aá]\b|onde\s+ficou\b|\bstatus\s+d[oe]\s+pedido\b|\bmeu\s+pedido\b|\bacompanhar\s+pedido\b|\bquanto\s+tempo\s+(?:falta|vai|leva)\b|\bprevis[aã]o\s+de\s+entrega\b)/iu;

const CHECKOUT_KEYWORDS = [
    "fechar pedido","fechar","pagar","finalizar","acabou","checkout","quero pagar","fecha",
    "bater caixa","vou pagar","quero finalizar","vou finalizar","pode fechar","fecha ai",
    "bater o caixa","quero fechar","encerrar","terminar","quero confirmar",
    "nao quero mais","nao quero mais nada","era so isso","so isso mesmo",
    "chega por hoje","chega por ora","nao preciso mais","era isso ai","mais nao","nao mais",
    "pronto pode fechar","ta bom assim","to bom assim","isso e tudo","e so isso",
];

const CANCEL_UNRELATED_QUESTION_STEPS = new Set([
    "checkout_payment", "checkout_address", "awaiting_address_number",
    "awaiting_address_neighborhood", "awaiting_address_selection", "awaiting_variant_selection",
]);

const CHECKOUT_PROTECTED_STEPS = new Set([
    "checkout_address", "awaiting_address_number", "awaiting_address_neighborhood",
    "awaiting_address_selection", "checkout_payment", "checkout_confirm",
    "awaiting_cancel_confirm", "awaiting_split_order",
]);

const GREETING_ALLOWED_STEPS = new Set(["main_menu", "welcome", ""]);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function reply(admin: Parameters<typeof botReply>[0], companyId: string, threadId: string, phoneE164: string, text: string): Promise<void> {
    await botReply(admin, companyId, threadId, phoneE164, text);
}

function resetUnknownCount(session: Session): void {
    session.context.consecutive_unknown_count = 0;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function detectGlobalIntents(
    params: ProcessMessageParams,
    session: Session,
    config: CompanyConfig
): Promise<{ handled: boolean }> {
    const { admin, companyId, threadId, phoneE164 } = params;
    const input       = params.text.trim();
    const normInput   = normalize(input);
    const companyName = config.name;

    // ── 1. Global reset ───────────────────────────────────────────────────────
    if (EXPLICIT_RESET_RE.test(normInput)) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await sendInteractiveButtons(phoneE164, `Como posso te ajudar no *${companyName}*? 🍺`, [
            { id: "btn_catalog", title: "🍺 Ver cardápio" },
            { id: "btn_status",  title: "📦 Meu pedido" },
            { id: "btn_support", title: "🙋 Falar c/ atendente" },
        ]);
        return { handled: true };
    }

    if (NAV_RESET_RE.test(normInput)) {
        if (session.cart.length > 0) {
            await saveSession(admin, threadId, companyId, { step: "main_menu" });
            await sendInteractiveButtons(
                phoneE164,
                `Como posso te ajudar no *${companyName}*? 🍺\n\n_Seu carrinho foi mantido (${session.cart.length} ${session.cart.length === 1 ? "item" : "itens"})._`,
                [
                    { id: "btn_catalog", title: "🍺 Ver cardápio" },
                    { id: "btn_status",  title: "📦 Meu pedido" },
                    { id: "btn_support", title: "🙋 Falar c/ atendente" },
                ]
            );
        } else {
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await sendInteractiveButtons(phoneE164, `Como posso te ajudar no *${companyName}*? 🍺`, [
                { id: "btn_catalog", title: "🍺 Ver cardápio" },
                { id: "btn_status",  title: "📦 Meu pedido" },
                { id: "btn_support", title: "🙋 Falar c/ atendente" },
            ]);
        }
        return { handled: true };
    }

    // ── 2. Handover ───────────────────────────────────────────────────────────
    if (matchesAny(input, ["atendente", "humano", "pessoa", "falar com alguem", "ajuda"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return { handled: true };
    }

    // ── 3. Detecção de nome do cliente ────────────────────────────────────────
    const detectedName = extractClientName(input);
    if (detectedName) {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, client_name: detectedName },
        });
        session.context.client_name = detectedName;
        if (session.customer_id) {
            await admin.from("customers").update({ name: detectedName }).eq("id", session.customer_id);
        }
        await reply(admin, companyId, threadId, phoneE164, `Olá, *${detectedName}*! 😊 Como posso te ajudar?`);
        return { handled: true };
    }

    // ── 4. Remove intent (retira/tira + produto) ──────────────────────────────
    if (detectRemoveIntent(input) && session.cart.length > 0) {
        const withoutVerb  = normInput.replace(REMOVE_VERBS_RE, "").trim();
        const removeTerms  = withoutVerb.split(/\s+/u).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
        if (removeTerms.length > 0) {
            const idx = session.cart.findIndex((c) =>
                removeTerms.some((t) => normalize(c.name).includes(t))
            );
            if (idx >= 0) {
                const item    = session.cart[idx];
                const newCart = session.cart.filter((_, i) => i !== idx);
                await saveSession(admin, threadId, companyId, { cart: newCart });
                await reply(
                    admin, companyId, threadId,
                    phoneE164,
                    `🗑️ *${item.name}* removido do pedido.\n\n${newCart.length > 0 ? formatCart(newCart) : "Carrinho vazio."}`
                );
                return { handled: true };
            }
        }
    }

    // ── 5. Cancel handling ────────────────────────────────────────────────────
    const botHasOpenQuestion       = CANCEL_UNRELATED_QUESTION_STEPS.has(session.step);
    const negationSuppressesCancel = NEGATION_CANCEL_RE.test(input) && !botHasOpenQuestion;
    const isCancelarInput          = CANCELAR_TEST_RE.test(input) && !negationSuppressesCancel;

    if (isCancelarInput) {
        const withoutCancel = normInput.replace(CANCELAR_STRIP_RE, "").trim();
        const cancelTerms   = withoutCancel.split(/\s+/u).filter((w) => w.length >= 2 && !STOPWORDS.has(w));

        if (cancelTerms.length > 0) {
            if (session.cart.length > 0) {
                const idx = session.cart.findIndex((c) =>
                    cancelTerms.some((t) => normalize(c.name).includes(t))
                );
                if (idx >= 0) {
                    const item    = session.cart[idx];
                    const newCart = [...session.cart];
                    if (item.qty > 1) {
                        newCart[idx] = { ...item, qty: item.qty - 1 };
                        await saveSession(admin, threadId, companyId, { cart: newCart, context: session.context });
                        await reply(admin, companyId, threadId, phoneE164, `↩️ *${item.name}*: agora ${item.qty - 1}x no carrinho.`);
                    } else {
                        newCart.splice(idx, 1);
                        await saveSession(admin, threadId, companyId, { cart: newCart, context: session.context });
                        await reply(admin, companyId, threadId, phoneE164, `🗑️ *${item.name}* removido do carrinho.`);
                    }
                    return { handled: true };
                }
            }
            // No match → fall through
        } else {
            if (session.step !== "awaiting_cancel_confirm") {
                await saveSession(admin, threadId, companyId, {
                    step: "awaiting_cancel_confirm",
                    context: { ...session.context, pre_cancel_step: session.step },
                });
                await reply(admin, companyId, threadId, phoneE164, "⚠️ Tem certeza que quer *cancelar o pedido*?\n\nResponda *sim* para confirmar ou *não* para continuar.");
                return { handled: true };
            }
        }
    }

    // ── 6. awaiting_cancel_confirm ────────────────────────────────────────────
    if (session.step === "awaiting_cancel_confirm") {
        const isYes = AWAIT_CANCEL_YES_RE.test(normInput);
        const isNo  = AWAIT_CANCEL_NO_RE.test(normInput);
        if (isYes) {
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await sendInteractiveButtons(
                phoneE164,
                `✅ Pedido cancelado. Como posso te ajudar no *${companyName}*?`,
                [
                    { id: "btn_catalog", title: "🍺 Ver cardápio" },
                    { id: "btn_status",  title: "📦 Meu pedido" },
                    { id: "btn_support", title: "🙋 Falar c/ atendente" },
                ]
            );
        } else if (isNo) {
            const prevStep = (session.context.pre_cancel_step as string) ?? "main_menu";
            await saveSession(admin, threadId, companyId, { step: prevStep, context: { ...session.context, pre_cancel_step: undefined } });
            await reply(admin, companyId, threadId, phoneE164, "Ok, continuando seu pedido! 😊");
        } else {
            await reply(admin, companyId, threadId, phoneE164, "Responda *sim* para cancelar o pedido ou *não* para continuar.");
        }
        return { handled: true };
    }

    // ── 7. Affirmative global (checkout_confirm) ──────────────────────────────
    if (AFFIRMATIVE_RE.test(input) && session.step === "checkout_confirm") {
        const hasNegation = NEGATION_RE.test(input);
        const wordCount   = input.trim().split(/\s+/u).length;

        if (!hasNegation) {
            if (wordCount <= 4) {
                await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, "confirmar", session);
                return { handled: true };
            } else {
                await sendInteractiveButtons(
                    phoneE164,
                    `Entendi que você quer *confirmar o pedido*, é isso?`,
                    [
                        { id: "confirmar",    title: "✅ Sim, confirmar" },
                        { id: "change_items", title: "✏️ Não, alterar" },
                    ]
                );
                return { handled: true };
            }
        }
    }

    // ── 8. Checkout keywords ──────────────────────────────────────────────────
    if (matchesAny(input, CHECKOUT_KEYWORDS) && session.cart.length > 0) {
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
        return { handled: true };
    }

    // ── 8b. Global negative/positive (qualquer step com carrinho) ─────────────
    if (session.cart.length > 0 && !CHECKOUT_PROTECTED_STEPS.has(session.step)) {
        const GLOBAL_NEGATIVE_RE = /^(nao|nop[es]?|nah|chega(?:u)?|ta\s+bom|to\s+bom|blz|beleza|so\s+isso|era\s+so\s+isso|isso\s+mesmo|era\s+isso|fechou|prontinho|ja\s+basta|nao\s+obrigad[oa]|nao\s+preciso|nao\s+quero\s+mais|ja\s+e\s+suficiente|pode\s+fechar|fecha\s+ai|e\s+so\s+isso|e\s+tudo)$/iu;
        const GLOBAL_POSITIVE_RE  = /^(sim|bora|vamos|claro|top|quero\s+mais|ver\s+mais|me\s+mostra\s+mais|tem\s+mais|mostra\s+mais)$/iu;

        if (GLOBAL_NEGATIVE_RE.test(normInput)) {
            await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, session);
            return { handled: true };
        }
        if (GLOBAL_POSITIVE_RE.test(normInput)) {
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
            return { handled: true };
        }
    }

    // ── 9. Payment detection for payment step ─────────────────────────────────
    if (session.step === "checkout_payment") {
        const detectedPayment = detectPaymentMethod(input);
        if (detectedPayment) {
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, input, session);
            return { handled: true };
        }
    }

    // ── 10. Multiple delivery addresses ───────────────────────────────────────
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
        return { handled: true };
    }

    // ── 10.5. Regex quick-resolve (zero tokens de IA) ─────────────────────────
    if (GREETING_ONLY_RE.test(input) && GREETING_ALLOWED_STEPS.has(session.step)) {
        resetUnknownCount(session);
        // Avança step para main_menu para evitar dupla saudação quando o cliente
        // clicar em um botão do menu logo após receber a saudação.
        if (session.step !== "main_menu") {
            await saveSession(admin, threadId, companyId, { step: "main_menu" });
        }
        await sendInteractiveButtons(phoneE164, `Como posso te ajudar no *${companyName}*? 🍺`, [
            { id: "btn_catalog", title: "🍺 Ver cardápio" },
            { id: "btn_status",  title: "📦 Meu pedido" },
            { id: "btn_support", title: "🙋 Falar c/ atendente" },
        ]);
        return { handled: true };
    }

    if (ORDER_STATUS_RE.test(input)) {
        resetUnknownCount(session);
        await replyWithOrderStatus(admin, companyId, threadId, phoneE164);
        return { handled: true };
    }

    return { handled: false };
}
