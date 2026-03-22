/**
 * lib/chatbot/handlers/handleCheckout.ts
 *
 * Handlers para o fluxo de checkout: endereço, seleção de endereço salvo,
 * pagamento e confirmação do pedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, VariantRow } from "../types";
import { saveSession } from "../session";
import { formatCurrency, formatCart, cartTotal, matchesAny, isCaseVariant, NUMBER_EMOJIS } from "../utils";
import { detectPaymentMethod } from "../textParsers";
import { findDeliveryZone, listDeliveryZones, getCategories } from "../db/variants";
import { getOrCreateCustomer, createOrder } from "../db/orders";
import { getAccompanimentItems } from "../db/variants";
import { commitAddress, sendPaymentButtonsAddr } from "./handleAddress";
import { buildProductDisplayName } from "../displayHelpers";
import { getOrderParserService } from "../OrderParserService";
import { getWhatsAppConfig } from "../../whatsapp/getConfig";
import { sendWhatsAppMessage, sendInteractiveButtons, sendFlowMessage } from "../../whatsapp/send";

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── sendPaymentButtons ───────────────────────────────────────────────────────

export async function sendPaymentButtons(phoneE164: string): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        "💳 Como deseja pagar?",
        [
            { id: "card", title: "Cartão" },
            { id: "pix",  title: "PIX" },
            { id: "cash", title: "Dinheiro" },
        ]
    );
}

// ─── isAddressComplete ────────────────────────────────────────────────────────

/** Verifica se o endereço tem número da casa; se não, botão Confirmar não deve aparecer */
export function isAddressComplete(session: Session): boolean {
    const structured = session.context.delivery_address_structured as { numero?: string } | null;
    if (structured?.numero && String(structured.numero).trim().length > 0) return true;
    if (session.context.address_draft && session.context.address_validation_error) return false;
    const addr = (session.context.delivery_address as string) ?? "";
    return /\d{1,5}/.test(addr);
}

// ─── sendOrderSummary ─────────────────────────────────────────────────────────

/**
 * Envia resumo do pedido no WhatsApp com itens (preços ERP), endereço validado e total c/ frete.
 * 3 botões: Confirmar Pedido, Alterar Itens, Mudar Endereço.
 * Se faltar número do endereço, pergunta pela informação e não exibe botão Confirmar.
 */
export async function sendOrderSummary(
    phoneE164: string,
    session: Session
): Promise<void> {
    const cart = session.cart;
    const address = (session.context.delivery_address as string) ?? "—";
    const paymentMethod = (session.context.payment_method as string) ?? "—";
    const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
    const paymentLabel = pmLabels[paymentMethod] ?? paymentMethod;
    const changeFor = (session.context.change_for as number | null) ?? null;
    const deliveryFee = (session.context.delivery_fee as number | null) ?? 0;

    const changeText = changeFor ? `\n💵 Troco: ${formatCurrency(changeFor)}` : "";
    const feeText = deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}` : "";
    const productsTotal = cartTotal(cart);
    const grandTotal = productsTotal + deliveryFee;
    const grandText = deliveryFee > 0 ? `\n\n💰 *Total final: ${formatCurrency(grandTotal)}*` : "";

    const addressComplete = isAddressComplete(session);
    if (!addressComplete) {
        await reply(
            phoneE164,
            `📋 *Resumo do pedido:*\n\n${formatCart(cart)}${feeText}\n` +
            `📍 Endereço: ${address}\n\n` +
            `⚠️ Para confirmar, preciso do *número* do endereço. Qual é o número da casa?`
        );
        await sendInteractiveButtons(phoneE164, "Enquanto isso:", [
            { id: "change_items", title: "🔄 Alterar itens" },
            { id: "change_address", title: "📍 Mudar endereço" },
        ]);
        return;
    }

    await reply(
        phoneE164,
        `📋 *Resumo do pedido:*\n\n` +
        `${formatCart(cart)}\n` +
        `${feeText}\n` +
        `📍 Entrega: ${address}\n` +
        `💳 Pagamento: ${paymentLabel}${changeText}` +
        `${grandText}`
    );
    await sendInteractiveButtons(phoneE164, "Confirmar o pedido?", [
        { id: "confirmar", title: "✅ Confirmar pedido" },
        { id: "change_items", title: "🔄 Alterar itens" },
        { id: "change_address", title: "📍 Mudar endereço" },
    ]);
}

// ─── goToCheckoutAddress ──────────────────────────────────────────────────────

export async function goToCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    const customer   = await getOrCreateCustomer(admin, companyId, phoneE164);
    const customerId = customer?.id ?? null;
    const saved      = customer?.address ?? null;

    if (saved) {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: saved },
        });
        await reply(
            phoneE164,
            `📍 *Endereço de entrega cadastrado:*\n${saved}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
    } else {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: null, awaiting_address: true },
        });
        await reply(
            phoneE164,
            `📍 Qual é o seu *endereço de entrega*?\n\n` +
            `_Ex: Rua das Flores, 123, Bairro Centro_`
        );
    }
}

// ─── goToCheckoutFromCart ─────────────────────────────────────────────────────

/**
 * Se o contexto já tem endereço e pagamento → checkout_confirm.
 * Se tem endereço mas não pagamento → checkout_payment (não pede endereço de novo).
 * Se não tem endereço → checkout_address.
 */
export async function goToCheckoutFromCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    const address = session.context.delivery_address as string | undefined;
    const payment = session.context.payment_method   as string | undefined;

    if (address && payment) {
        await saveSession(admin, threadId, companyId, { step: "checkout_confirm" });
        await sendOrderSummary(phoneE164, session);
        return;
    }

    if (address && !payment) {
        const customer = await getOrCreateCustomer(admin, companyId, phoneE164);
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_payment",
            customer_id: customer?.id ?? session.customer_id,
            context:     session.context,
        });
        await sendPaymentButtons(phoneE164);
        return;
    }

    // Sem endereço: usa WhatsApp Flow se configurado, senão fluxo conversacional
    const wppConfig = await getWhatsAppConfig(admin, companyId);
    if (wppConfig.flowId) {
        const customer    = await getOrCreateCustomer(admin, companyId, phoneE164);
        const customerId  = customer?.id ?? session.customer_id ?? null;

        // Verifica endereços salvos (skip se usuário pediu novo endereço)
        const skipSaved = !!(session.context.skip_saved_addresses);
        if (customerId && !skipSaved) {
            const { data: savedAddrs } = await admin
                .from("enderecos_cliente")
                .select("id, apelido, logradouro, numero, complemento, bairro")
                .eq("customer_id", customerId)
                .eq("company_id", companyId)
                .order("is_principal", { ascending: false })
                .limit(5);

            if (savedAddrs && savedAddrs.length > 0) {
                // Máx 2 endereços + "Novo endereço" = 3 botões (limite WhatsApp)
                const addrToShow = savedAddrs.slice(0, 2);
                const addrLines = addrToShow.map((a) => {
                    const detail = [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", ");
                    const label  = a.apelido ?? a.logradouro ?? "Endereço";
                    return `📍 *${label}*: ${detail}`;
                }).join("\n");

                const buttons = [
                    ...addrToShow.map((a) => ({
                        id:    `addr_${a.id}`,
                        title: (a.apelido ?? a.logradouro ?? "Endereço").slice(0, 20),
                    })),
                    { id: "new_address", title: "Novo endereço" },
                ];

                await saveSession(admin, threadId, companyId, {
                    step:        "awaiting_address_selection",
                    customer_id: customerId,
                    context:     { ...session.context, saved_addresses: savedAddrs },
                });
                await sendInteractiveButtons(
                    phoneE164,
                    `📍 *Endereço de entrega*\n\n${addrLines}\n\nEscolha abaixo ou adicione um novo:`,
                    buttons
                );
                return;
            }
        }

        const flowToken = `${threadId}|${companyId}`;
        await saveSession(admin, threadId, companyId, {
            step:        "awaiting_flow",
            customer_id: customerId,
            context:     { ...session.context, flow_token: flowToken, skip_saved_addresses: undefined },
        });
        const cartSummary = session.cart.map((i) => `${i.qty}x ${i.name}`).join(", ");
        await sendFlowMessage(phoneE164, {
            flowToken,
            bodyText: `🛒 *${cartSummary}*\n\nPreencha o endereço e forma de pagamento:`,
            ctaLabel: "Preencher dados",
            flowId:   wppConfig.flowId,
        });
    } else {
        await goToCheckoutAddress(admin, companyId, threadId, phoneE164, session);
    }
}

// ─── handleAwaitingAddressSelection ──────────────────────────────────────────

export async function handleAwaitingAddressSelection(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    // "Novo endereço" → reutiliza goToCheckoutFromCart com flag skip_saved_addresses
    if (input === "new_address") {
        const freshSession = {
            ...session,
            context: { ...session.context, saved_addresses: undefined, skip_saved_addresses: true },
        };
        await saveSession(admin, threadId, companyId, { context: freshSession.context });
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, freshSession);
        return;
    }

    // Endereço salvo selecionado: input = "addr_<uuid>"
    if (input.startsWith("addr_")) {
        const addrId = input.slice(5);
        const { data: addrRow } = await admin
            .from("enderecos_cliente")
            .select("logradouro, numero, complemento, bairro")
            .eq("id", addrId)
            .maybeSingle();

        if (!addrRow) {
            await reply(phoneE164, "Endereço não encontrado. Por favor, escolha outra opção.");
            return;
        }

        const fullAddress = [addrRow.logradouro, addrRow.numero, addrRow.complemento, addrRow.bairro]
            .filter(Boolean).join(", ");
        const neighborhood = addrRow.bairro ?? "";

        const zone = await findDeliveryZone(admin, companyId, neighborhood);
        const deliveryFee = zone ? Number(zone.fee) : 0;

        await saveSession(admin, threadId, companyId, {
            step:        "checkout_payment",
            customer_id: session.customer_id ?? undefined,
            context: {
                ...session.context,
                saved_addresses:  undefined,
                delivery_address: fullAddress,
                delivery_fee:     deliveryFee,
                delivery_zone_id: zone?.id ?? null,
            },
        });
        await sendPaymentButtons(phoneE164);
        return;
    }

    // Input desconhecido → reexibe os botões
    const savedAddrs = (session.context.saved_addresses as Array<{
        id: string; apelido: string | null; logradouro: string | null;
        numero: string | null; complemento: string | null; bairro: string | null;
    }>) ?? [];
    if (savedAddrs.length > 0) {
        const addrToShow = savedAddrs.slice(0, 2);
        const addrLines  = addrToShow.map((a) => {
            const detail = [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", ");
            const label  = a.apelido ?? a.logradouro ?? "Endereço";
            return `📍 *${label}*: ${detail}`;
        }).join("\n");
        const buttons = [
            ...addrToShow.map((a) => ({
                id:    `addr_${a.id}`,
                title: (a.apelido ?? a.logradouro ?? "Endereço").slice(0, 20),
            })),
            { id: "new_address", title: "Novo endereço" },
        ];
        await sendInteractiveButtons(
            phoneE164,
            `📍 *Endereço de entrega*\n\n${addrLines}\n\nEscolha abaixo ou adicione um novo:`,
            buttons
        );
    }
}

// ─── handleCheckoutAddress ────────────────────────────────────────────────────

export async function handleCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session,
    _profileName?: string | null
): Promise<void> {
    const savedAddress   = session.context.saved_address   as string | null;
    const awaitingAddress = session.context.awaiting_address as boolean | undefined;

    // Temos endereço salvo e aguardamos "1" ou "2"
    if (savedAddress && !awaitingAddress) {
        if (input === "1") {
            await saveSession(admin, threadId, companyId, {
                step:        "checkout_payment",
                customer_id: session.customer_id,
                context:     { ...session.context, delivery_address: savedAddress },
            });
            await sendPaymentButtons(phoneE164);
            return;
        }
        if (input === "2") {
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, saved_address: null, awaiting_address: true },
            });
            await reply(phoneE164, `📍 Informe o novo endereço de entrega:\n\n_Ex: Rua das Flores, 123_`);
            return;
        }
        // Input inválido → repete a pergunta
        await reply(
            phoneE164,
            `📍 *Endereço cadastrado:*\n${savedAddress}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
        return;
    }

    // Aguardando digitação do endereço
    if (input.length < 5) {
        await reply(phoneE164, "Por favor, informe o endereço completo (rua, número e bairro).");
        return;
    }

    // 1) Exige número no endereço
    if (!/\d/.test(input)) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_address_number",
            context: { ...session.context, address_draft: input, saved_address: null, awaiting_address: false },
        });
        await reply(phoneE164, `📍 Endereço parcial: *${input}*\n\nQual é o *número* do endereço? (ex: 120, 456)`);
        return;
    }

    // 2) Valida com Google
    const parser = getOrderParserService();
    const parsedAddr = await parser.validateAddress(input);
    const finalAddr  = parsedAddr?.formatted ?? input;
    const neighborhood = parsedAddr?.neighborhood ?? null;

    // 2b) Google não confirmou o número → rejeita
    if (parsedAddr && !parsedAddr.houseNumber) {
        await reply(
            phoneE164,
            `❌ Não consegui confirmar o número do endereço.\n\n` +
            `Por favor, informe novamente com *rua, número e bairro*.\n_Ex: Rua das Flores, 123, Centro_`
        );
        return;
    }

    // 3) Google não retornou bairro → pede
    if (!neighborhood) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_address_neighborhood",
            context: {
                ...session.context,
                address_draft:    finalAddr,
                saved_address:    null,
                awaiting_address: false,
                delivery_address_structured: parsedAddr ? {
                    rua:       parsedAddr.street    ?? "",
                    numero:    parsedAddr.houseNumber ?? null,
                    bairro:    "",
                    formatted: finalAddr,
                    placeId:   parsedAddr.placeId   ?? "",
                } : null,
            },
        });
        await reply(
            phoneE164,
            `📍 Endereço: *${finalAddr}*\n\n` +
            `Para calcular o frete, qual é o seu *bairro*? (ex: Centro, Residencial Bela Vista)`
        );
        return;
    }

    // 4) Bairro confirmado → salva e vai para pagamento
    await commitAddress(admin, companyId, threadId, phoneE164, session, finalAddr, neighborhood, parsedAddr ?? undefined);
}

// ─── handleCheckoutPayment ────────────────────────────────────────────────────

export async function handleCheckoutPayment(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    // ── Sub-step: aguardando valor do troco ───────────────────────────────────
    if (session.context.awaiting_change_for) {
        let changeFor: number | null = null;

        if (!matchesAny(input, ["nao", "não", "n", "sem troco"])) {
            const parsed = parseFloat(input.replace(",", ".").replace(/[^0-9.]/g, ""));
            if (isNaN(parsed) || parsed <= 0) {
                await reply(phoneE164, "Digite o valor do troco (ex: *50*) ou *não* se não precisar.");
                return;
            }
            changeFor = parsed;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "checkout_confirm",
            context: { ...session.context, change_for: changeFor, awaiting_change_for: false },
        });
        await sendOrderSummary(phoneE164, { ...session, context: { ...session.context, change_for: changeFor, awaiting_change_for: false } });
        return;
    }

    // ── Seleção de forma de pagamento ─────────────────────────────────────────
    // Valores aceitos pelo DB: "pix" | "cash" | "card"
    const paymentMap: Record<string, string> = {
        "1":       "card",
        "2":       "pix",
        "3":       "cash",
        "cartao":  "card",
        "cartão":  "card",
        "card":    "card",
        "credito": "card",
        "debito":  "card",
        "pix":     "pix",
        "dinheiro":"cash",
        "cash":    "cash",
    };

    const normalizedInput = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    let method = paymentMap[normalizedInput] ?? detectPaymentMethod(input);
    if (!method) {
        await sendPaymentButtons(phoneE164);
        return;
    }

    if (method === "cash") {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, payment_method: "cash", awaiting_change_for: true },
        });
        await reply(phoneE164, "💵 Troco para quanto?\n\nDigite o valor (ex: *50*) ou *não* se não precisar de troco.");
        return;
    }

    // pix ou card → vai direto para confirmação
    await saveSession(admin, threadId, companyId, {
        step:    "checkout_confirm",
        context: { ...session.context, payment_method: method },
    });
    await sendOrderSummary(phoneE164, { ...session, context: { ...session.context, payment_method: method } });
}

// ─── handleCheckoutConfirm ────────────────────────────────────────────────────

export async function handleCheckoutConfirm(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
): Promise<void> {
    const address       = (session.context.delivery_address as string) ?? "";
    const paymentMethod = (session.context.payment_method   as string) ?? "cash";
    const changeFor     = (session.context.change_for       as number | null) ?? null;

    // "Mudar endereço" (ID change_address ou texto) → reabre o Flow (ou fluxo conversacional)
    if (
        input === "change_address" ||
        matchesAny(input, ["alterar_endereco", "alterar endereco", "alterar endereço", "mudar endereço", "trocar endereço"])
    ) {
        const clearedContext = {
            ...session.context,
            delivery_address:   undefined,
            delivery_fee:       undefined,
            delivery_zone_id:   undefined,
            payment_method:     undefined,
            change_for:         undefined,
            flow_address_done:  undefined,
            flow_apelido:       undefined,
            flow_bairro_label:  undefined,
        };
        const clearedSession = { ...session, context: clearedContext };
        await saveSession(admin, threadId, companyId, { context: clearedContext });
        await goToCheckoutFromCart(admin, companyId, threadId, phoneE164, clearedSession);
        return;
    }

    // "Alterar itens" (ID change_items ou texto) → vai para cart preservando endereço/pagamento
    if (
        input === "change_items" ||
        matchesAny(input, ["adicionar_produtos", "adicionar produtos"])
    ) {
        await saveSession(admin, threadId, companyId, {
            step:  "cart",
            context: session.context, // preserva endereço, pagamento, etc.
        });
        await reply(
            phoneE164,
            `Entendido! Pode digitar o que deseja *adicionar* ou *remover* do seu carrinho.\n\n` +
            `${formatCart(session.cart)}\n\n` +
            `_Digite o nome do produto para adicionar, *remover N* para tirar o item N, ou *finalizar* para fechar._`
        );
        return;
    }

    // Etapa: aguardando nome (pedido no final, antes de confirmar)
    if (session.context.awaiting_name_confirm) {
        const nameInput = input.trim();
        if (nameInput.length < 2) {
            await reply(phoneE164, "Por favor, digite seu nome completo.");
            return;
        }

        let customerId = session.customer_id;
        if (!customerId) {
            const recovered = await getOrCreateCustomer(admin, companyId, phoneE164);
            customerId = recovered?.id ?? null;
        }
        if (customerId) {
            await admin.from("customers").update({ name: nameInput }).eq("id", customerId);
        } else {
            const { data: inserted } = await admin.from("customers").insert({
                company_id: companyId,
                phone:      phoneE164,
                name:       nameInput,
            }).select("id").single();
            customerId = (inserted as any)?.id ?? null;
        }

        await saveSession(admin, threadId, companyId, {
            customer_id: customerId,
            context:     { ...session.context, awaiting_name_confirm: false },
        });

        // Após salvar nome, verificar maioridade
        const { data: custRow } = await admin
            .from("customers")
            .select("is_adult")
            .eq("id", customerId)
            .maybeSingle();

        if (!custRow?.is_adult) {
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, awaiting_name_confirm: false, awaiting_age_confirm: true },
            });
            await reply(
                phoneE164,
                "Para prosseguir com o pedido, confirme: você é *maior de 18 anos*? Responda *sim* ou *não*."
            );
            return;
        }
        // Nome salvo e já é maior → criar pedido diretamente (pula checagem de input)
        const feeForOrder = (session.context.delivery_fee as number | null) ?? 0;
        try {
            const orderId = await createOrder(admin, companyId, customerId!, session.cart, paymentMethod, address, changeFor, feeForOrder);
            const orderShort = orderId.replace(/-/g, "").slice(-8).toUpperCase();
            const cartSnapshot = [...session.cart];
            // Limpeza de sessão assim que o insert retornar sucesso: cart zerado, step em home
            await saveSession(admin, threadId, companyId, {
                step: "main_menu", cart: [], context: { last_order_id: orderId },
            });
            const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
            const paymentLine = paymentMethod === "cash"
                ? `💳 Pagamento: Dinheiro${changeFor ? ` (troco para ${formatCurrency(changeFor)})` : ""}`
                : `💳 Pagamento: ${pmLabels[paymentMethod] ?? paymentMethod}`;
            await reply(
                phoneE164,
                `✅ *Pedido confirmado!* 🍺\n\n${formatCart(cartSnapshot)}\n\n📍 Endereço: ${address}\n${paymentLine}\n🔖 Pedido: #${orderShort}\n\n📦 Recebemos seu pedido e já estamos preparando!\n_Obrigado por pedir no ${companyName}!_`
            );
            try {
                const accompaniments = await getAccompanimentItems(admin, companyId, cartSnapshot.map((c) => c.variantId));
                if (accompaniments.length > 0) {
                    const lines = accompaniments.map((v) => {
                            return `• ${buildProductDisplayName(v)} — ${formatCurrency(v.unitPrice)}`;
                    });
                    await reply(phoneE164, `🛒 *Que tal adicionar ao seu pedido?*\n\n${lines.join("\n")}\n\n_Digite *1* para ver o cardápio completo ou *menu* para voltar ao início._`);
                }
            } catch { /* ignore */ }
            return;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[checkout_confirm] ERRO ao criar pedido:", msg);
            await reply(phoneE164, "Desculpe, houve um erro ao registrar seu pedido. Por favor, fale com um atendente. 😞");
            return;
        }
    }

    // Etapa: aguardando confirmação de maioridade
    if (session.context.awaiting_age_confirm) {
        if (matchesAny(input, ["sim", "s", "sou maior", "maior", "confirmar", "confirmo"])) {
            // Marca cliente como adulto
            if (session.customer_id) {
                await admin.from("customers").update({ is_adult: true }).eq("id", session.customer_id);
            } else {
                const phoneClean = phoneE164.replace(/\D/g, "");
                const { data: existing } = await admin
                    .from("customers")
                    .select("id")
                    .eq("company_id", companyId)
                    .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
                    .limit(1)
                    .maybeSingle();
                if (existing?.id) {
                    await admin.from("customers").update({ is_adult: true }).eq("id", existing.id);
                }
            }

            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, awaiting_age_confirm: false },
            });
            // Após confirmar maioridade, segue fluxo normal de confirmação abaixo
        } else if (matchesAny(input, ["nao", "não", "n", "sou menor", "menor"])) {
            await reply(
                phoneE164,
                "Para continuar, é necessário ser maior de 18 anos. Seu pedido não foi finalizado."
            );
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            return;
        } else {
            await reply(
                phoneE164,
                "Por favor, responda *sim* se você é maior de 18 anos, ou *não* se não for."
            );
            return;
        }
    }

    // Input não reconhecido → reenviar resumo SEM cancelar o pedido
    if (!matchesAny(input, ["confirmar", "confirmar pedido", "confirmo", "sim", "ok", "s", "1"])) {
        await reply(phoneE164, "⚠️ Por favor, use os botões para confirmar ou alterar o pedido:");
        await sendOrderSummary(phoneE164, session);
        return;
    }

    let customerId = session.customer_id;
    if (!customerId) {
        console.warn("[checkout_confirm] customer_id ausente — tentando recuperar | threadId:", threadId);
        const recovered = await getOrCreateCustomer(admin, companyId, phoneE164);
        if (!recovered) {
            console.error("[checkout_confirm] Falha ao recuperar customer | threadId:", threadId);
            await reply(phoneE164, "Houve um erro interno. Por favor, tente novamente. 😞");
            return;
        }
        customerId = recovered.id;
        await saveSession(admin, threadId, companyId, { customer_id: customerId });
    }

    // Antes de criar o pedido: nome e maioridade (no final do fluxo)
    const { data: customerRow } = await admin
        .from("customers")
        .select("name, is_adult")
        .eq("id", customerId)
        .maybeSingle();

    const hasName = !!(customerRow?.name && String(customerRow.name).trim().length >= 2);
    if (!hasName) {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, awaiting_name_confirm: true },
        });
        await reply(phoneE164, "Para finalizar, qual é o seu *nome*?");
        return;
    }

    if (!customerRow?.is_adult) {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, awaiting_age_confirm: true },
        });
        await reply(
            phoneE164,
            "Para prosseguir com o pedido, confirme: você é *maior de 18 anos*? Responda *sim* ou *não*."
        );
        return;
    }

    try {
        const feeForOrder = (session.context.delivery_fee as number | null) ?? 0;
        const orderId     = await createOrder(admin, companyId, customerId, session.cart, paymentMethod, address, changeFor, feeForOrder);
        const orderShort = orderId.replace(/-/g, "").slice(-8).toUpperCase();

        // Limpeza de sessão assim que o insert retornar sucesso: cart zerado, step em home
        const cartSnapshot = [...session.cart];
        await saveSession(admin, threadId, companyId, {
            step:    "main_menu",
            cart:    [],
            context: { last_order_id: orderId },
        });

        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const paymentLine = paymentMethod === "cash"
            ? `💳 Pagamento: Dinheiro${changeFor ? ` (troco para ${formatCurrency(changeFor)})` : ""}`
            : `💳 Pagamento: ${pmLabels[paymentMethod] ?? paymentMethod}`;

        await reply(
            phoneE164,
            `✅ *Pedido confirmado!* 🍺\n\n` +
            `${formatCart(cartSnapshot)}\n\n` +
            `📍 Endereço: ${address}\n` +
            `${paymentLine}\n` +
            `🔖 Pedido: #${orderShort}\n\n` +
            `📦 Recebemos seu pedido e já estamos preparando!\n` +
            `_Obrigado por pedir no ${companyName}!_`
        );

        // ── Sugestão de acompanhamentos (baseado no que comprou) ────────────────
        try {
            const cartEmbalagemIds = cartSnapshot.map((c) => c.variantId);
            const accompaniments = await getAccompanimentItems(admin, companyId, cartEmbalagemIds);
            if (accompaniments.length > 0) {
                const lines = accompaniments.map((v) => {
                    return `• ${buildProductDisplayName(v)} — ${formatCurrency(v.unitPrice)}`;
                });
                await reply(
                    phoneE164,
                    `🛒 *Que tal adicionar ao seu pedido?*\n\n${lines.join("\n")}\n\n` +
                    `_Digite *1* para ver o cardápio completo ou *menu* para voltar ao início._`
                );
            }
        } catch { /* não bloqueia o fluxo principal */ }

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[checkout_confirm] ERRO ao criar pedido:", msg);
        await reply(
            phoneE164,
            `Desculpe, houve um erro ao registrar seu pedido. Por favor, fale com um atendente. 😞`
        );
    }
}

// ─── handleAwaitingVariantSelection ──────────────────────────────────────────

export async function handleAwaitingVariantSelection(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const variantOptions = (session.context.variant_options as VariantRow[]) ?? [];
    if (!variantOptions.length) {
        await saveSession(admin, threadId, companyId, { step: "catalog_products" });
        await reply(phoneE164, "Não encontrei as opções anteriores. O que você gostaria?");
        return;
    }

    const defaultQty = Number(session.context.variant_qty ?? 1);

    // Parse selections: support "3x1", "2 x 1", "1 2 3", single numbers
    interface Sel { idx: number; qty: number }
    const selections: Sel[] = [];

    // Try "NxM" or "N x M" format first (qty x option)
    const qxoRe = /(\d+)\s*x\s*(\d+)/gi;
    let qxoMatch: RegExpExecArray | null;
    let hasQxo = false;
    const inputForParsing = input;
    while ((qxoMatch = qxoRe.exec(inputForParsing)) !== null) {
        const q = parseInt(qxoMatch[1], 10);
        const opt = parseInt(qxoMatch[2], 10) - 1;
        if (opt >= 0 && opt < variantOptions.length) {
            selections.push({ idx: opt, qty: q });
            hasQxo = true;
        }
    }

    if (!hasQxo) {
        // Fall back: each space/comma separated number = one option, qty = defaultQty
        const nums = input.split(/[\s,]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= variantOptions.length);
        for (const n of nums) {
            const existing = selections.find(s => s.idx === n - 1);
            if (existing) existing.qty += defaultQty;
            else selections.push({ idx: n - 1, qty: defaultQty });
        }
    }

    if (!selections.length) {
        const listText = variantOptions.map((v, i) => {
            const isCase = isCaseVariant(v);
            const nm     = buildProductDisplayName(v, isCase);
            const price  = isCase ? (v.casePrice ?? v.unitPrice) : v.unitPrice;
            return `${NUMBER_EMOJIS[i] ?? `${i+1}.`} *${nm}* — ${formatCurrency(price)}`;
        }).join("\n");
        await reply(phoneE164, `Digite o número da opção:\n\n${listText}\n\n_Ex: "1" para primeira opção, "1 2" para duas opções, "3x1" para 3 unidades da opção 1_`);
        return;
    }

    let newCart = [...session.cart];
    const addedItems: string[] = [];

    for (const sel of selections) {
        const v = variantOptions[sel.idx];
        if (!v) continue;
        const name = buildProductDisplayName(v);
        const cartIdx = newCart.findIndex(c => c.variantId === v.id);
        if (cartIdx >= 0) {
            newCart[cartIdx] = { ...newCart[cartIdx], qty: newCart[cartIdx].qty + sel.qty };
        } else {
            newCart.push({ variantId: v.id, productId: v.productId, name, price: v.unitPrice, qty: sel.qty, isCase: false });
        }
        addedItems.push(`${sel.qty}x ${name}`);
    }

    const total = newCart.reduce((s, i) => s + i.price * i.qty, 0);
    await saveSession(admin, threadId, companyId, {
        step: "catalog_products",
        cart: newCart,
        context: { ...session.context, variant_options: undefined, variant_qty: undefined },
    });

    const cartText = newCart.length > 0 ? `\n\n🛒 *Pedido:*\n${formatCart(newCart)}\n\n💰 *Total: ${formatCurrency(total)}*` : "";
    await sendInteractiveButtons(
        phoneE164,
        `✅ Adicionado: ${addedItems.join(", ")}!${cartText}\n\nQuer mais alguma coisa?`,
        [
            { id: "mais_produtos", title: "Mais produtos" },
            { id: "finalizar",     title: "Finalizar pedido" },
        ]
    );
}

// ─── handleAwaitingSplitOrder ─────────────────────────────────────────────────

export async function handleAwaitingSplitOrder(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const normInput = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const isSplit = normInput === "1" || /\bsepar/i.test(input);
    const isSingle = normInput === "2" || /\b(mesmo|unico|único|so um)\b/i.test(input);

    if (isSplit) {
        await saveSession(admin, threadId, companyId, {
            step: "checkout_address",
            context: { ...session.context, split_order: true, awaiting_address: true },
        });
        await reply(phoneE164, "📍 Dois pedidos separados! Qual é o *primeiro endereço de entrega*?");
        return;
    }

    if (isSingle) {
        const addr1 = (session.context.split_address_1 as string) ?? "";
        const addr2 = (session.context.split_address_2 as string) ?? "";
        await saveSession(admin, threadId, companyId, {
            step: "catalog_products",
            context: {
                ...session.context,
                split_order: false,
                delivery_address: addr1 && addr2 ? `${addr1} / ${addr2}` : addr1 || addr2,
            },
        });
        await reply(phoneE164, `📍 Certo! Entregaremos em *${addr1}* e *${addr2}*.\n\nContinue adicionando produtos ou finalize o pedido.`);
        return;
    }

    await reply(
        phoneE164,
        "Serão dois pedidos com pagamentos diferentes ou somente um pedido entregue em dois endereços?\n\n" +
        "1️⃣ Dois pedidos separados\n2️⃣ Um pedido, dois endereços"
    );
}
