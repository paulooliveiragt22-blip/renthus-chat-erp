/**
 * lib/chatbot/handlers/handleMainMenu.ts
 *
 * Handlers para o menu principal: welcome, main_menu, fallback de baixa confiança
 * e handover para atendente humano.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import Anthropic from "@anthropic-ai/sdk";
import type { Session, CartItem } from "../types";
import { saveSession } from "../session";
import {
    formatCurrency, matchesAny, isWithinBusinessHours,
    getMenuOptionsOnly,
} from "../utils";
import { getCategories } from "../db/variants";
import { getOrCreateCustomer } from "../db/orders";
import { handleFreeTextInput } from "./handleFreeText";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage } from "../../whatsapp/send";
import { searchProductsForTool } from "../services/dbService";

// ─── claudeNaturalReply ───────────────────────────────────────────────────────

const STEP_CONTEXT: Record<string, string> = {
    catalog_products:           "cliente está escolhendo produtos do cardápio",
    catalog_categories:         "cliente está escolhendo uma categoria do cardápio",
    awaiting_variant_selection: "cliente precisa escolher uma variante e quantidade (ex: 1x2 = opção 1 com 2 unidades)",
    checkout_payment:           "cliente precisa informar forma de pagamento: PIX, Cartão ou Dinheiro",
    checkout_address:           "cliente precisa informar endereço de entrega",
    awaiting_address_selection: "cliente está escolhendo um endereço salvo ou adicionando novo",
    awaiting_address_number:    "cliente precisa informar apenas o número do endereço",
    awaiting_address_neighborhood: "cliente precisa informar o bairro",
    checkout_confirm:           "cliente está confirmando o pedido",
    main_menu:                  "cliente está no menu principal",
    awaiting_flow:              "cliente tem um formulário de endereço/pagamento aberto no WhatsApp",
};

/**
 * Chama Claude Haiku para gerar uma resposta natural quando o regex não reconheceu o input.
 * NUNCA retorna erro ao cliente — sempre responde de forma útil e redireciona.
 */
export async function claudeNaturalReply(params: {
    input:       string;
    step:        string;
    cart:        CartItem[];
    lastBotMsg:  string;
    companyName: string;
    admin?:      SupabaseClient;
    companyId?:  string;
}): Promise<string> {
    const cartText = params.cart.length > 0
        ? params.cart.map((i) => `${i.qty}x ${i.name}`).join(", ")
        : "vazio";

    const stepDesc = STEP_CONTEXT[params.step] ?? "atendimento geral";

    const systemPrompt = `Você é um atendente virtual de delivery da distribuidora "${params.companyName}". REGRAS ABSOLUTAS — nunca viole:

1. NUNCA invente produtos, preços, marcas ou disponibilidade.
2. Se o cliente perguntar sobre um produto, SEMPRE chame a tool buscar_produto antes de confirmar qualquer informação.
3. Se buscar_produto retornar results=[], diga: "Esse item não está disponível no momento."
4. NUNCA confirme estoque, temperatura, sabores ou especificações não listadas.
5. NUNCA mencione preços que não vieram da buscar_produto.
6. Se não souber a resposta, direcione: "Que tal ver nosso cardápio completo?"
7. Respostas máximo 2 frases curtas. Sem emojis excessivos.`;

    const userMessage = `Contexto atual: ${stepDesc}
Carrinho: ${cartText}
Última mensagem do bot: "${params.lastBotMsg}"
Mensagem do cliente: "${params.input}"

Responda em português brasileiro de forma natural e curta (máx 2 frases).
NÃO diga "não entendi", "não reconheço" ou similares.
Seja útil, educado e direcione para o próximo passo correto.`;

    const tools: Anthropic.Tool[] = [
        {
            name: "buscar_produto",
            description:
                "Busca um produto no catálogo pelo nome ou descrição. " +
                "SEMPRE chame esta tool antes de confirmar disponibilidade ou preço de qualquer produto.",
            input_schema: {
                type: "object" as const,
                properties: {
                    query: {
                        type: "string",
                        description: "Nome ou descrição do produto a buscar",
                    },
                },
                required: ["query"],
            },
        },
    ];

    try {
        const client = new Anthropic();

        // Primeira chamada — Claude pode chamar a tool buscar_produto
        const firstMsg = await client.messages.create(
            {
                model:      "claude-haiku-4-5-20251001",
                max_tokens: 300,
                system:     systemPrompt,
                tools,
                messages:   [{ role: "user", content: userMessage }],
            },
            { timeout: 3500 }
        );

        // Se Claude chamou a tool e temos acesso ao DB
        if (
            firstMsg.stop_reason === "tool_use" &&
            params.admin &&
            params.companyId
        ) {
            const toolUse = firstMsg.content.find((b) => b.type === "tool_use");
            if (toolUse && toolUse.type === "tool_use" && toolUse.name === "buscar_produto") {
                const query   = (toolUse.input as { query: string }).query;
                const results = await searchProductsForTool(params.admin, params.companyId, query);

                // Segunda chamada — Claude gera resposta baseada APENAS no resultado real
                const secondMsg = await client.messages.create(
                    {
                        model:      "claude-haiku-4-5-20251001",
                        max_tokens: 150,
                        system:     systemPrompt,
                        tools,
                        messages: [
                            { role: "user",      content: userMessage },
                            { role: "assistant", content: firstMsg.content },
                            {
                                role: "user",
                                content: [{
                                    type:        "tool_result" as const,
                                    tool_use_id: toolUse.id,
                                    content:     JSON.stringify({ results }),
                                }],
                            },
                        ],
                    },
                    { timeout: 2000 }
                );

                const block = secondMsg.content.find((b) => b.type === "text");
                return block && block.type === "text" ? block.text.trim() : "Como posso te ajudar? 😊";
            }
        }

        // Sem tool use — resposta direta (chitchat, saudação, etc.)
        const block = firstMsg.content.find((b) => b.type === "text");
        return block && block.type === "text" ? block.text.trim() : "Como posso te ajudar? 😊";
    } catch {
        // Fallback silencioso — nunca expõe erro técnico ao cliente
        return "Como posso te ajudar? 😊";
    }
}

// ─── Sanitização de resposta Claude ──────────────────────────────────────────

const PRICE_RE = /R\$\s*[\d.,]+/g;
const SAFE_REPLY = "Não encontrei esse item no nosso cardápio. Posso te mostrar o que temos disponível? 😊";

/**
 * Verifica se o texto gerado pelo Claude contém preços não catalogados.
 * Se encontrar, substitui por resposta segura para evitar alucinação de preço.
 */
export function sanitizeClaudeReply(text: string, catalogPrices: number[]): string {
    const pricesInText = text.match(PRICE_RE);
    if (!pricesInText) return text;

    for (const rawPrice of pricesInText) {
        const numeric = parseFloat(
            rawPrice.replace(/[R$\s]/g, "").replace(",", ".")
        );
        const isInCatalog = catalogPrices.some((p) => Math.abs(p - numeric) < 0.01);
        if (!isInCatalog) return SAFE_REPLY;
    }
    return text;
}

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

    // Handover automático após 3 tentativas sem entender
    if (count >= 3) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return true;
    }

    // Tenta sugerir produtos próximos via Fuse.js (sem expor ao cliente diretamente)
    let fuseHint = "";
    if (input && products.length > 0) {
        const fuse = new Fuse(products, {
            keys:      [{ name: "productName", weight: 0.7 }, { name: "tags", weight: 0.3 }],
            threshold: 0.5,
            includeScore: true,
        });
        const hits = fuse.search(input).slice(0, 3).filter((r) => (r.score ?? 1) < 0.5);
        if (hits.length > 0) {
            fuseHint = "\nProdutos próximos: " + hits.map((r) => r.item.productName).join(", ");
        }
    }

    // Claude Haiku responde de forma natural — sem "não entendi"
    const lastBotMsg = (session.context.last_bot_question as string | undefined) ?? "";
    const rawReply = await claudeNaturalReply({
        input:       input + fuseHint,
        step:        session.step,
        cart:        session.cart,
        lastBotMsg,
        companyName,
        admin,
        companyId,
    });
    const catalogPrices = products.map((p) => p.unitPrice);
    const naturalReply = sanitizeClaudeReply(rawReply, catalogPrices);

    await reply(phoneE164, naturalReply);
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
            if (ftEarly === "handled") return;
            if (ftEarly === "notfound") {
                await saveSession(admin, threadId, companyId, { step: "main_menu" });
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

    // Input inválido (skip ou outro) → Claude responde + repete menu
    const naturalReply = await claudeNaturalReply({
        input,
        step:        "main_menu",
        cart:        session.cart,
        lastBotMsg:  `Como posso te ajudar no ${companyName}?`,
        companyName,
        admin,
        companyId,
    });
    await reply(phoneE164, naturalReply);
    await sendInteractiveButtons(
        phoneE164,
        `Como posso te ajudar no *${companyName}*?`,
        [
            { id: "1", title: "🍺 Ver cardápio" },
            { id: "2", title: "📦 Meu pedido" },
            { id: "3", title: "🙋 Falar c/ atendente" },
        ]
    );
}
