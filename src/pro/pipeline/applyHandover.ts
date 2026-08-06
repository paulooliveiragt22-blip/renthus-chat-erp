/**
 * Efeito colateral do handover humano no pipeline PRO.
 * Espelha `doHandover` do Starter: desliga bot + ticket (sem reenviar mensagem —
 * o outbound já sai por `persistAndEmit`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplyHandoverParams = {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    customerName?: string | null;
    reason?: string;
};

export type ApplyHandoverResult = {
    threadUpdated: boolean;
    ticketCreated: boolean;
    ticketId: string | null;
};

export async function applyProHandover(params: ApplyHandoverParams): Promise<ApplyHandoverResult> {
    const {
        admin,
        companyId,
        threadId,
        phoneE164,
        customerName,
        reason = "Cliente solicitou atendimento humano via WhatsApp",
    } = params;

    const nowIso = new Date().toISOString();

    const { error: threadErr } = await admin
        .from("whatsapp_threads")
        .update({ bot_active: false, handover_at: nowIso })
        .eq("id", threadId)
        .eq("company_id", companyId);

    if (threadErr) {
        throw new Error(`handover_thread_update: ${threadErr.message}`);
    }

    const { data: existing } = await admin
        .from("support_tickets")
        .select("id")
        .eq("company_id", companyId)
        .eq("customer_phone", phoneE164)
        .in("status", ["open", "in_progress"])
        .maybeSingle();

    if (existing?.id) {
        return {
            threadUpdated: true,
            ticketCreated: false,
            ticketId: existing.id as string,
        };
    }

    const { data: ticket, error: ticketErr } = await admin
        .from("support_tickets")
        .insert({
            company_id: companyId,
            customer_phone: phoneE164,
            customer_name: customerName ?? null,
            message: reason,
            priority: "normal",
            status: "open",
        })
        .select("id")
        .single();

    if (ticketErr) {
        throw new Error(`handover_ticket_insert: ${ticketErr.message}`);
    }

    return {
        threadUpdated: true,
        ticketCreated: true,
        ticketId: (ticket?.id as string) ?? null,
    };
}
