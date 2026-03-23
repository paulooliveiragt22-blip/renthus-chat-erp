/**
 * lib/chatbot/handlers/handleAddress.ts
 *
 * Handlers para etapas de coleta de endereço: número, bairro e commit do endereço.
 * Nota: sendPaymentButtons é duplicado aqui (não importado de handleCheckout.ts)
 * para evitar circular import: handleCheckout.ts → handleAddress.ts → handleCheckout.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "../types";
import { saveSession } from "../session";
import { formatCurrency } from "../utils";
import { findDeliveryZone } from "../db/variants";
import { getOrderParserService } from "../OrderParserService";
import { claudeNaturalReply } from "./handleMainMenu";
import { sendWhatsAppMessage, sendInteractiveButtons } from "../../whatsapp/send";

// ─── Helpers locais ───────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

/** Envio dos botões de pagamento — duplicado aqui para evitar circular import com handleCheckout.ts */
export async function sendPaymentButtonsAddr(phoneE164: string): Promise<void> {
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

// ─── commitAddress ────────────────────────────────────────────────────────────

/**
 * Persiste endereço validado (Google + bairro resolvido), atualiza customer e vai para pagamento.
 */
export async function commitAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session,
    finalAddr: string,
    neighborhood: string,
    parsedAddr?: { street?: string; houseNumber?: string; placeId?: string; formatted?: string }
): Promise<void> {
    const zone = await findDeliveryZone(admin, companyId, neighborhood);

    if (session.customer_id) {
        await admin.from("customers")
            .update({ address: finalAddr, neighborhood })
            .eq("id", session.customer_id);

        const { data: existingAddr } = await admin
            .from("enderecos_cliente")
            .select("id")
            .eq("customer_id", session.customer_id)
            .eq("apelido", "Chatbot")
            .maybeSingle();

        if (existingAddr?.id) {
            await admin.from("enderecos_cliente").update({
                logradouro:   finalAddr,
                bairro:       neighborhood,
                is_principal: true,
            }).eq("id", existingAddr.id);
        } else {
            await admin.from("enderecos_cliente").insert({
                company_id:   companyId,
                customer_id:  session.customer_id,
                apelido:      "Chatbot",
                logradouro:   finalAddr,
                bairro:       neighborhood,
                is_principal: true,
            });
        }
    }

    await saveSession(admin, threadId, companyId, {
        step:        "checkout_payment",
        customer_id: session.customer_id,
        context: {
            ...session.context,
            delivery_address:    finalAddr,
            delivery_neighborhood: neighborhood,
            delivery_fee:        zone?.fee ?? null,
            delivery_zone_id:    zone?.id  ?? null,
            delivery_address_structured: parsedAddr ? {
                rua:       parsedAddr.street      ?? "",
                numero:    parsedAddr.houseNumber  ?? null,
                bairro:    neighborhood,
                formatted: finalAddr,
                placeId:   parsedAddr.placeId      ?? "",
            } : null,
            address_draft:         undefined,
            address_validation_error: undefined,
            saved_address:         null,
            awaiting_address:      false,
        },
    });

    const feeText = zone ? `\n🛵 Taxa ${zone.label}: *${formatCurrency(zone.fee)}*` : "";
    await reply(phoneE164, `📍 Endereço confirmado: *${finalAddr}* — ${neighborhood}${feeText}`);
    await sendPaymentButtonsAddr(phoneE164);
}

// ─── handleAwaitingAddressNumber ──────────────────────────────────────────────

export async function handleAwaitingAddressNumber(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const addressDraft = (session.context.address_draft as string) ?? "";
    if (!addressDraft) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", context: { ...session.context, address_draft: undefined } });
        await reply(phoneE164, "Não encontrei o endereço anterior. Pode informar novamente? (Ex: Rua das Flores, 123)");
        return;
    }

    const numMatch = input.trim().match(/(\d{1,5})/u);
    const number = numMatch ? numMatch[1] : input.trim();
    if (!number) {
        await reply(phoneE164, "Por favor, digite apenas o *número* do endereço (ex: 120).");
        return;
    }

    const combinedAddress = addressDraft.includes(number) ? addressDraft : `${addressDraft}, ${number}`.replace(/\s*,\s*,\s*/, ", ");
    const parser = getOrderParserService();
    const parsedAddr = await parser.validateAddress(combinedAddress);

    if (parsedAddr) {
        const neighborhood = parsedAddr.neighborhood ?? null;

        // Google não confirmou o número → rejeita
        if (!parsedAddr.houseNumber) {
            await saveSession(admin, threadId, companyId, {
                step:    "checkout_address",
                context: { ...session.context, address_draft: undefined, awaiting_address: true },
            });
            const naturalReply = await claudeNaturalReply({
                input,
                step:        "awaiting_address_number",
                cart:        session.cart,
                lastBotMsg:  "Qual é o número do endereço?",
                companyName: "",
            });
            await reply(phoneE164, `${naturalReply}\n\n_Ex: Rua das Flores, 123, Centro_`);
            return;
        }

        // Sem bairro → pede bairro antes de ir ao pagamento
        if (!neighborhood) {
            const finalAddr = parsedAddr.formatted ?? combinedAddress;
            await saveSession(admin, threadId, companyId, {
                step: "awaiting_address_neighborhood",
                context: {
                    ...session.context,
                    address_draft:    finalAddr,
                    address_validation_error: undefined,
                    delivery_address_structured: {
                        rua:       parsedAddr.street      ?? "",
                        numero:    parsedAddr.houseNumber  ?? null,
                        bairro:    "",
                        formatted: finalAddr,
                        placeId:   parsedAddr.placeId      ?? "",
                    },
                },
            });
            await reply(
                phoneE164,
                `📍 Endereço: *${finalAddr}*\n\n` +
                `Para calcular o frete, qual é o seu *bairro*? (ex: Centro, Residencial Bela Vista)`
            );
            return;
        }

        await commitAddress(admin, companyId, threadId, phoneE164, session, parsedAddr.formatted ?? combinedAddress, neighborhood, parsedAddr);
        return;
    }

    const naturalReply = await claudeNaturalReply({
        input,
        step:        "awaiting_address_number",
        cart:        session.cart,
        lastBotMsg:  "Qual é o número do endereço?",
        companyName: "",
    });
    await reply(phoneE164, naturalReply);
}

// ─── handleAwaitingAddressNeighborhood ────────────────────────────────────────

export async function handleAwaitingAddressNeighborhood(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const addressDraft = (session.context.address_draft as string) ?? "";
    if (!addressDraft) {
        await saveSession(admin, threadId, companyId, { step: "checkout_address", context: { ...session.context, awaiting_address: true } });
        await reply(phoneE164, "Não encontrei o endereço anterior. Pode informar novamente? (Ex: Rua das Flores, 123)");
        return;
    }

    const neighborhood = input.trim();
    if (neighborhood.length < 2) {
        const naturalReply = await claudeNaturalReply({
            input,
            step:        "awaiting_address_neighborhood",
            cart:        session.cart,
            lastBotMsg:  "Qual é o bairro?",
            companyName: "",
        });
        await reply(phoneE164, naturalReply);
        return;
    }

    // Combina endereço + bairro e valida novamente para obter formatted correto
    const parser     = getOrderParserService();
    const combined   = `${addressDraft}, ${neighborhood}`;
    const parsedAddr = await parser.validateAddress(combined);
    const finalAddr  = parsedAddr?.formatted ?? combined;
    const resolvedNeighborhood = parsedAddr?.neighborhood ?? neighborhood;

    await commitAddress(admin, companyId, threadId, phoneE164, session, finalAddr, resolvedNeighborhood, parsedAddr ?? undefined);
}
