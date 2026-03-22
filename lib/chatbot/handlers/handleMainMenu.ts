/**
 * lib/chatbot/handlers/handleMainMenu.ts
 *
 * Handlers para o menu principal: welcome, main_menu, fallback de baixa confiança
 * e handover para atendente humano.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import type { Session } from "../types";
import { saveSession } from "../session";
import {
    formatCurrency, matchesAny, isWithinBusinessHours,
    getMenuOptionsOnly, buildMainMenu,
} from "../utils";
import { getCategories } from "../db/variants";
import { getOrCreateCustomer } from "../db/orders";
import { handleFreeTextInput } from "./handleFreeText";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage } from "../../whatsapp/send";

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── Envia menu como botões interativos ───────────────────────────────────────

/** Envia menu como botões interativos (fallback após 2 inputs desconhecidos) */
export async function sendInteractiveMenuFallback(phoneE164: string, companyName: string): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        `Como posso te ajudar no *${companyName}*?`,
        [
            { id: "1", title: "Ver cardápio" },
            { id: "2", title: "Status do pedido" },
            { id: "3", title: "Falar com atendente" },
        ]
    );
}

// ─── Handover ─────────────────────────────────────────────────────────────────

export async function doHandover(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<void> {
    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId),

        saveSession(admin, threadId, companyId, { ...session, step: "handover" }),
    ]);

    await reply(
        phoneE164,
        `👋 Vou te conectar com um atendente do *${companyName}*.\n\n` +
        `_Aguarde, alguém responderá em breve._`
    );
}

// ─── Low-confidence fallback ──────────────────────────────────────────────────

/**
 * Fallback inteligente: quando OrderParserService retorna confiança baixa (< 0.3)
 * e o usuário NÃO está em step de texto livre.
 * 1ª vez: pergunta educadamente se quer adicionar produto ou falar com atendente.
 * 2ª vez: envia List Message com categorias do ERP.
 */
/** Mensagem de fallback específica por step — evita "falando com uma parede" */
function buildStepFallbackHint(step: string): string | null {
    switch (step) {
        case "checkout_payment":
            return "Desculpe, não entendi. Você prefere *PIX*, *Cartão* ou *Dinheiro*?";
        case "checkout_address":
            return "Pode me confirmar apenas o *nome da rua e o número*?";
        case "awaiting_address_number":
            return "Qual é o *número* do endereço? (ex: 123)";
        case "awaiting_address_neighborhood":
            return "Qual é o *bairro*?";
        case "awaiting_variant_selection":
            return "Por favor, escolha a variante pelo *número* indicado.";
        case "awaiting_address_selection":
            return "Escolha um dos endereços listados ou *digite um novo endereço completo*.";
        case "checkout_confirm":
            return "Desculpe, não entendi. Digite *confirmar* para fechar o pedido ou *cancelar* para desistir.";
        default:
            return null;
    }
}

export async function handleLowConfidenceFallback(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session,
    input = "",
    products: { productName: string; unitPrice: number; tags?: string | null }[] = []
): Promise<boolean> {
    const count = ((session.context.consecutive_unknown_count as number) ?? 0) + 1;
    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, consecutive_unknown_count: count },
    });

    if (count === 1) {
        // Fallback inteligente: dica específica ao step atual
        const stepHint = buildStepFallbackHint(session.step);
        if (stepHint) {
            await reply(phoneE164, stepHint);
            return true;
        }

        // Sem dica de step: tenta sugerir produtos próximos via Fuse.js
        let suggestionText = "";
        if (input && products.length > 0) {
            const fuse = new Fuse(products, {
                keys: [{ name: "productName", weight: 0.7 }, { name: "tags", weight: 0.3 }],
                threshold: 0.5,
                includeScore: true,
            });
            const hits = fuse.search(input).slice(0, 3).filter((r) => (r.score ?? 1) < 0.5);
            if (hits.length > 0) {
                const lines = hits.map((r) => `• *${r.item.productName}* — ${formatCurrency(r.item.unitPrice)}`);
                suggestionText = `Você quis dizer algum destes?\n\n${lines.join("\n")}\n\n`;
            }
        }
        await reply(
            phoneE164,
            `${suggestionText}Não entendi bem. 😅 Digite o nome do produto ou escolha uma opção:`
        );
        await sendInteractiveButtons(phoneE164, "Como posso ajudar?", [
            { id: "1", title: "Ver cardápio" },
            { id: "2", title: "Status do pedido" },
            { id: "3", title: "Falar com atendente" },
        ]);
        return true;
    }

    // Layer 4: IA não entendeu em 2 turnos → handover automático
    await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
    return true;
}

/** Incrementa consecutive_unknown_count; se >= 2, aciona handover automático e retorna true */
export async function handleUnknownInputAndMaybeSendMenu(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<boolean> {
    const count = ((session.context.consecutive_unknown_count as number) ?? 0) + 1;
    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, consecutive_unknown_count: count },
    });
    if (count >= 2) {
        // Layer 4: fallback após 2 turnos sem entender → handover automático
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return true;
    }
    return false;
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function handleMainMenu(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    settings: Record<string, unknown>,
    input: string,
    session: Session,
    profileName?: string | null
): Promise<void> {
    // Primeira mensagem → prioriza pedido/endereço; só manda saudação se input curto ou notfound
    if (session.step === "welcome") {
        if (!isWithinBusinessHours(settings)) {
            const msg = (settings?.closed_message as string) ??
                "Olá! No momento estamos fechados. Volte em breve. 😊";
            await reply(phoneE164, msg);
            return;
        }

        const phoneClean = phoneE164.replace(/\D/g, "");
        const { data: customer } = await admin
            .from("customers")
            .select("id, name")
            .eq("company_id", companyId)
            .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
            .limit(1)
            .maybeSingle();

        const looksLikeProduct = /\s/.test(input) || /\d/.test(input);
        if (looksLikeProduct && input.length > 2) {
            const ftEarly = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
            await saveSession(admin, threadId, companyId, { step: "main_menu" });
            if (ftEarly === "handled") return;
            if (ftEarly === "notfound") {
                await reply(phoneE164, `Não encontrei _"${input}"_.\n\n${getMenuOptionsOnly()}`);
                return;
            }
        }

        await saveSession(admin, threadId, companyId, { step: "main_menu" });
        const hasName = !!(customer?.name && customer.name.trim().length > 0);
        const greetText = hasName
            ? `Olá, *${customer!.name.trim()}*! 🍺\n\nVocê pode digitar o que precisa que já vejo pra você.`
            : `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nVocê pode digitar o que precisa que já vejo pra você.`;
        await sendInteractiveButtons(phoneE164, greetText, [
            { id: "1", title: "🍺 Ver cardápio" },
            { id: "2", title: "📦 Meu pedido" },
            { id: "3", title: "🙋 Falar c/ atendente" },
        ]);
        return;
    }

    // Opção 1: Ver cardápio
    if (input === "1" || matchesAny(input, ["cardapio", "produtos", "bebidas", "ver"])) {
        const categories = await getCategories(admin, companyId);

        if (!categories.length) {
            await reply(phoneE164, "Ops! Nenhuma categoria cadastrada ainda. Tente mais tarde. 😅");
            return;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { ...session.context, categories, consecutive_unknown_count: 0 },
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

    // Opção 2: Status do pedido
    if (input === "2" || matchesAny(input, ["status", "pedido", "onde", "acompanhar"])) {
        await saveSession(admin, threadId, companyId, { context: { ...session.context, consecutive_unknown_count: 0 } });
        const customer = await getOrCreateCustomer(admin, companyId, phoneE164, profileName);

        if (!customer) {
            await reply(phoneE164, "Não encontrei cadastro para o seu número. 😅");
            return;
        }

        const { data: lastOrder } = await admin
            .from("orders")
            .select("id, status, created_at, total_amount")
            .eq("company_id", companyId)
            .eq("customer_id", customer.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastOrder) {
            await reply(phoneE164,
                "Você ainda não fez nenhum pedido por aqui. 😊\n" +
                "Digite *1* para ver o cardápio!"
            );
            return;
        }

        const statusLabels: Record<string, string> = {
            new:       "✅ Recebido",
            confirmed: "✅ Confirmado",
            preparing: "🔥 Em preparo",
            delivering:"🛵 Saiu para entrega",
            delivered: "📦 Entregue",
            finalized: "✅ Finalizado",
            canceled:  "❌ Cancelado",
        };

        const label = statusLabels[lastOrder.status] ?? lastOrder.status;
        const date  = new Date(lastOrder.created_at).toLocaleString("pt-BR");

        await reply(
            phoneE164,
            `*Seu último pedido:*\n\n` +
            `📋 Status: ${label}\n` +
            `💰 Total: ${formatCurrency(lastOrder.total_amount)}\n` +
            `📅 Data: ${date}\n\n` +
            `_Digite *1* para fazer um novo pedido._`
        );
        return;
    }

    // Opção 3: Falar com atendente
    if (input === "3" || matchesAny(input, ["atendente", "humano"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // Texto livre → tenta buscar produto antes de repetir menu
    const ftResult = await handleFreeTextInput(admin, companyId, threadId, phoneE164, input, session);
    if (ftResult === "handled") return;

    // Fallback: após 2 inputs desconhecidos, envia menu interativo (botões WhatsApp)
    const sentMenu = await handleUnknownInputAndMaybeSendMenu(admin, threadId, companyId, phoneE164, companyName, session);
    if (sentMenu) return;

    if (ftResult === "notfound") {
        await reply(phoneE164, `Não encontrei _"${input}"_.\n\n${getMenuOptionsOnly()}`);
        return;
    }

    // Input inválido (skip ou outro) → repete menu
    await reply(phoneE164, buildMainMenu(companyName));
}
