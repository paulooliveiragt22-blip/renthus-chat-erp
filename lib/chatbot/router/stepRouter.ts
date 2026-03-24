/**
 * lib/chatbot/router/stepRouter.ts
 *
 * Roteia para o handler correto baseado em session.step.
 * Puro switch/dispatch — sem lógica de negócio inline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, CompanyConfig } from "../types";
import type { ProcessMessageParams } from "../types";
import { saveSession } from "../session";
import { sendWhatsAppMessage, sendInteractiveButtons } from "../../whatsapp/send";
import { normalize } from "../utils";
import { handleMainMenu } from "../handlers/handleMainMenu";
import {
    handleCatalogCategories, handleCatalogProducts,
} from "../handlers/handleCatalog";
import { handleCart, goToCart } from "../handlers/handleCart";
import {
    goToCheckoutFromCart, handleAwaitingAddressSelection, handleCheckoutAddress,
    handleCheckoutPayment, handleCheckoutConfirm,
    handleAwaitingVariantSelection, handleAwaitingSplitOrder,
} from "../handlers/handleCheckout";
import { handleAwaitingAddressNumber, handleAwaitingAddressNeighborhood } from "../handlers/handleAddress";

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[stepRouter] Falha ao enviar resposta:", result.error);
    }
}

export async function routeByStep(
    params: ProcessMessageParams,
    session: Session,
    config: CompanyConfig
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, profileName } = params;
    const input       = params.text.trim();
    const companyName = config.name;
    const settings    = config.settings;

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
            // Handled by intentDetector before reaching the step router
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
            const FLOW_ESCAPE_RE  = /\b(?:cancelar|sair|voltar|menu|oi|ola)\b/iu;
            const flowStartedAt   = session.context.flow_started_at as string | undefined;
            const flowRepeatCount = ((session.context.flow_repeat_count as number) ?? 0);
            const flowExpired     = flowStartedAt
                ? Date.now() - new Date(flowStartedAt).getTime() > 5 * 60 * 1000
                : false;
            const flowStuck       = flowRepeatCount >= 3;

            if (FLOW_ESCAPE_RE.test(normalize(input)) || flowExpired || flowStuck) {
                const reason = flowStuck
                    ? "O formulário expirou, vamos recomeçar."
                    : "Formulário cancelado. Seu carrinho foi mantido! 😊";
                await saveSession(admin, threadId, companyId, {
                    step:    "main_menu",
                    context: { ...session.context, flow_token: undefined, flow_started_at: undefined, flow_repeat_count: undefined },
                });
                await sendInteractiveButtons(
                    phoneE164,
                    `${reason}\n\nComo posso te ajudar?`,
                    [
                        { id: "1", title: "🍺 Ver cardápio" },
                        { id: "finalizar", title: "Finalizar pedido" },
                        { id: "3", title: "🙋 Falar c/ atendente" },
                    ]
                );
            } else {
                await saveSession(admin, threadId, companyId, {
                    context: { ...session.context, flow_repeat_count: flowRepeatCount + 1 },
                });
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
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, { ...session, step: "main_menu", cart: [], context: {} }, profileName);
            break;

        default:
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, { ...session, step: "main_menu", cart: [], context: {} }, profileName);
    }
}
