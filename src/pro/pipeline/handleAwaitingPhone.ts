import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannelRef, ProSessionState, TenantRef } from "@/src/types/contracts";
import { normalizeBrPhone } from "@/lib/public-menu/phone";
import {
    linkCustomerChannelPhone,
    resolveOrCreateCustomerByIdentity,
} from "@/lib/chatbot/db/channelIdentity";

const ASK_PHONE_PT_BR =
    "Para finalizar seu pedido, preciso do seu *WhatsApp com DDD* (ex.: 11999998888).\n\n" +
    "É só uma vez — nas próximas compras já te reconheço.";

const INVALID_PHONE_PT_BR =
    "Não entendi o telefone. Envie só os números com DDD, por exemplo: *11999998888*.";

/**
 * Se a sessão pede telefone (1º checkout IG/Messenger), tenta capturar do texto.
 * Retorna outbound + state atualizado; `handled=true` encerra o turno.
 */
export async function handleAwaitingPhoneTurn(params: {
    admin: SupabaseClient;
    tenant: TenantRef;
    state: ProSessionState;
    userText: string;
    messagingChannel: MessagingChannelRef;
}): Promise<{ handled: boolean; state: ProSessionState; outboundText?: string }> {
    const { admin, tenant, state, userText, messagingChannel } = params;
    if (state.step !== "pro_awaiting_phone") {
        return { handled: false, state };
    }

    const channel = messagingChannel === "whatsapp" ? null : messagingChannel;
    if (!channel) {
        return { handled: false, state: { ...state, needsPhone: false, step: state.resumeStepAfterPhone ?? "pro_awaiting_confirmation" } };
    }

    const externalId = (tenant.channelUserId || "").trim();
    if (!externalId) {
        return {
            handled: true,
            state,
            outboundText: ASK_PHONE_PT_BR,
        };
    }

    // Garante customer da identidade
    let customerId = state.customerId;
    if (!customerId) {
        const resolved = await resolveOrCreateCustomerByIdentity(admin, {
            companyId: tenant.companyId,
            identity: { channel, externalId },
            name: null,
            origem: channel,
        });
        customerId = resolved?.customerId ?? null;
    }

    if (!customerId) {
        return {
            handled: true,
            state: {
                ...state,
                step: "pro_awaiting_phone",
                needsPhone: true,
                resumeStepAfterPhone: state.resumeStepAfterPhone ?? "pro_awaiting_confirmation",
            },
            outboundText: ASK_PHONE_PT_BR,
        };
    }

    const phone = normalizeBrPhone(userText);
    if (!phone.ok) {
        // Ainda pedindo — se o texto não parece telefone, reforça o pedido
        if (state.step !== "pro_awaiting_phone") {
            return {
                handled: true,
                state: {
                    ...state,
                    customerId,
                    step: "pro_awaiting_phone",
                    needsPhone: true,
                    resumeStepAfterPhone: "pro_awaiting_confirmation",
                },
                outboundText: ASK_PHONE_PT_BR,
            };
        }
        return {
            handled: true,
            state: { ...state, customerId, step: "pro_awaiting_phone", needsPhone: true },
            outboundText: INVALID_PHONE_PT_BR,
        };
    }

    const linked = await linkCustomerChannelPhone(admin, {
        companyId: tenant.companyId,
        customerId,
        phone: phone.digits,
        phoneE164: phone.phoneE164,
    });

    if (!linked) {
        return {
            handled: true,
            state: { ...state, customerId, step: "pro_awaiting_phone", needsPhone: true },
            outboundText: "Não consegui salvar seu telefone. Tente de novo ou digite *atendente*.",
        };
    }

    const resume = state.resumeStepAfterPhone ?? "pro_awaiting_confirmation";
    return {
        handled: true,
        state: {
            ...state,
            customerId: linked.customerId,
            needsPhone: false,
            resumeStepAfterPhone: null,
            step: resume,
        },
        outboundText:
            "Telefone salvo ✅\n\nAgora confirme o pedido com *Sim* ou *Confirmar*.",
    };
}

export function beginAwaitingPhone(state: ProSessionState): ProSessionState {
    return {
        ...state,
        needsPhone: true,
        resumeStepAfterPhone: state.step === "pro_awaiting_phone" ? state.resumeStepAfterPhone : state.step,
        step: "pro_awaiting_phone",
    };
}

export { ASK_PHONE_PT_BR };
