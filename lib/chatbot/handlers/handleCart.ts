/**
 * lib/chatbot/handlers/handleCart.ts
 *
 * Handlers para a etapa de carrinho e navegação para checkout.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, Category } from "../types";
import { saveSession } from "../session";
import { normalize, matchesAny, formatCart, buildMainMenu } from "../utils";
import { getCategories } from "../db/variants";
import { handleFreeTextInput } from "./handleFreeText";
import { sendWhatsAppMessage, sendListMessage } from "../../whatsapp/send";

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── goToCart ─────────────────────────────────────────────────────────────────

export async function goToCart(
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

// ─── handleCart ───────────────────────────────────────────────────────────────

export async function handleCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session,
    goToCheckoutFromCartFn: (admin: SupabaseClient, companyId: string, threadId: string, phoneE164: string, session: Session) => Promise<void>
): Promise<void> {
    if (matchesAny(input, ["finalizar", "fechar", "checkout", "confirmar"])) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Digite *1* para ver o cardápio.");
            return;
        }
        await goToCheckoutFromCartFn(admin, companyId, threadId, phoneE164, session);
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
