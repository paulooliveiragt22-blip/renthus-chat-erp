import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrCreateCustomerByIdentity } from "@/lib/chatbot/db/channelIdentity";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { detectConsentIntent } from "@/lib/channels/messageConsentKeywords";

export { detectConsentIntent, normalizeConsentKeyword } from "@/lib/channels/messageConsentKeywords";

export async function hasMarketingOptIn(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<boolean> {
    const { data } = await admin
        .from("customer_message_consents")
        .select("marketing_opt_in")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("channel", "whatsapp")
        .maybeSingle();
    return data?.marketing_opt_in === true;
}

export async function setMarketingConsent(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string;
    optIn: boolean;
    source: string;
}): Promise<void> {
    const now = new Date().toISOString();
    await params.admin.from("customer_message_consents").upsert(
        {
            company_id: params.companyId,
            customer_id: params.customerId,
            channel: "whatsapp",
            marketing_opt_in: params.optIn,
            opt_in_at: params.optIn ? now : null,
            opt_out_at: params.optIn ? null : now,
            source: params.source,
            updated_at: now,
        },
        { onConflict: "company_id,customer_id,channel" }
    );
}

/**
 * Se a mensagem for palavra de consentimento, atualiza opt-in/out, responde e
 * retorna true (= não enfileirar no bot).
 */
export async function handleWhatsappConsentKeyword(params: {
    admin: SupabaseClient;
    companyId: string;
    phoneE164: string;
    bodyText: string;
    waConfig: WaConfig;
}): Promise<boolean> {
    const intent = detectConsentIntent(params.bodyText);
    if (!intent) return false;

    const identity = await resolveOrCreateCustomerByIdentity(params.admin, {
        companyId: params.companyId,
        identity: { channel: "whatsapp", externalId: params.phoneE164 },
        name: null,
        origem: "whatsapp",
    });
    if (!identity?.customerId) {
        console.warn("[consent] não foi possível resolver customer para", params.phoneE164);
        return true;
    }

    if (intent === "opt_out") {
        await setMarketingConsent({
            admin: params.admin,
            companyId: params.companyId,
            customerId: identity.customerId,
            optIn: false,
            source: "inbound_keyword",
        });
        await sendWhatsAppMessage(
            params.phoneE164,
            "Pronto — você não receberá mais mensagens promocionais desta loja. " +
                "Para voltar a receber ofertas, envie: *QUERO OFERTAS*.",
            params.waConfig
        );
        return true;
    }

    await setMarketingConsent({
        admin: params.admin,
        companyId: params.companyId,
        customerId: identity.customerId,
        optIn: true,
        source: "inbound_keyword",
    });
    await sendWhatsAppMessage(
        params.phoneE164,
        "Obrigado! Você receberá ofertas desta loja no WhatsApp. " +
            "Para cancelar a qualquer momento, envie: *PARAR*.",
        params.waConfig
    );
    return true;
}
