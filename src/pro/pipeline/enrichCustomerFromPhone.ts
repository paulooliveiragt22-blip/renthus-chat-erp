import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannelRef, ProSessionState } from "@/src/types/contracts";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { resolveOrCreateCustomerByIdentity } from "@/lib/chatbot/db/channelIdentity";

/**
 * Garante `customerId` na sessão PRO.
 * WA: por phone. IG/Messenger: por identidade de canal (pode setar needsPhone).
 */
export async function enrichProSessionCustomerFromPhone(params: {
    admin: SupabaseClient | undefined;
    companyId: string;
    phoneE164: string;
    profileName: string | null;
    state: ProSessionState;
    messagingChannel?: MessagingChannelRef;
    channelUserId?: string;
}): Promise<ProSessionState> {
    const {
        admin,
        companyId,
        phoneE164,
        profileName,
        state,
        messagingChannel = "whatsapp",
        channelUserId,
    } = params;
    if (state.customerId || !admin) return state;

    if (messagingChannel === "whatsapp") {
        if (!phoneE164.trim()) return state;
        const c = await getOrCreateCustomer(admin, companyId, phoneE164, profileName ?? null);
        if (!c?.id) return state;
        return { ...state, customerId: c.id, needsPhone: false };
    }

    const externalId = (channelUserId || "").trim();
    if (!externalId) return state;

    const resolved = await resolveOrCreateCustomerByIdentity(admin, {
        companyId,
        identity: { channel: messagingChannel, externalId },
        name: profileName,
        origem: messagingChannel,
    });
    if (!resolved?.customerId) return state;

    return {
        ...state,
        customerId: resolved.customerId,
        needsPhone: resolved.needsPhone ? true : state.needsPhone,
    };
}
