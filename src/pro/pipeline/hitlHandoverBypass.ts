/**
 * Ingress HITL: clique Confirmar/Cancelar deve enfileirar mesmo com bot pausado,
 * desde que exista confirmação `pending` na thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { detectStructuredCheckoutAction } from "./orderConfirmationText";

export async function shouldEnqueueHitlCheckoutDespiteHandover(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    bodyText: string;
}): Promise<boolean> {
    const { admin, companyId, threadId, bodyText } = params;
    if (detectStructuredCheckoutAction(bodyText) == null) return false;

    const { data, error } = await admin
        .from("whatsapp_order_confirmations")
        .select("id")
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("[hitlHandoverBypass] pending lookup failed:", error.message);
        return false;
    }
    return Boolean(data?.id);
}
