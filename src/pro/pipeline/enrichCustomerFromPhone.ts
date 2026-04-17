import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProSessionState } from "@/src/types/contracts";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";

/**
 * Garante `customerId` na sessão PRO alinhado ao WhatsApp (`phoneE164`).
 * O `get_order_hints` já resolve cliente por telefone, mas o `prepare_order_draft`
 * usa `session.customerId`; sem isto o draft falha com "Não há cliente identificado…".
 */
export async function enrichProSessionCustomerFromPhone(params: {
    admin: SupabaseClient | undefined;
    companyId: string;
    phoneE164: string;
    profileName: string | null;
    state: ProSessionState;
}): Promise<ProSessionState> {
    const { admin, companyId, phoneE164, profileName, state } = params;
    if (state.customerId || !admin || !phoneE164.trim()) return state;
    const c = await getOrCreateCustomer(admin, companyId, phoneE164, profileName ?? null);
    if (!c?.id) return state;
    return { ...state, customerId: c.id };
}
