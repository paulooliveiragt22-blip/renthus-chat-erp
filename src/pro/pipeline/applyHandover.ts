/**
 * Efeito colateral do handover humano no pipeline PRO.
 * Espelha `doHandover` do Starter: desliga bot + ticket (sem reenviar mensagem —
 * o outbound já sai por `persistAndEmit`).
 *
 * Omnichannel: phone opcional; dedupe preferencial por `thread_id`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplyHandoverParams = {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    /** WhatsApp E.164; vazio/ausente em IG/Messenger sem vínculo. */
    phoneE164?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    channel?: "whatsapp" | "instagram" | "messenger" | "web" | null;
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
        customerId,
        customerName,
        channel,
        reason = "Cliente solicitou atendimento humano",
    } = params;

    const phone = (phoneE164 ?? "").trim() || null;
    const nowIso = new Date().toISOString();
    const messagingChannel = channel ?? (phone ? "whatsapp" : null);

    const { error: threadErr } = await admin
        .from("whatsapp_threads")
        .update({ bot_active: false, handover_at: nowIso })
        .eq("id", threadId)
        .eq("company_id", companyId);

    if (threadErr) {
        throw new Error(`handover_thread_update: ${threadErr.message}`);
    }

    // Dedupe 1: ticket aberto na mesma thread
    const { data: byThread } = await admin
        .from("support_tickets")
        .select("id")
        .eq("company_id", companyId)
        .eq("thread_id", threadId)
        .in("status", ["open", "in_progress"])
        .maybeSingle();

    if (byThread?.id) {
        return {
            threadUpdated: true,
            ticketCreated: false,
            ticketId: byThread.id as string,
        };
    }

    // Dedupe 2: legado por telefone
    if (phone) {
        const { data: byPhone } = await admin
            .from("support_tickets")
            .select("id")
            .eq("company_id", companyId)
            .eq("customer_phone", phone)
            .in("status", ["open", "in_progress"])
            .maybeSingle();

        if (byPhone?.id) {
            await admin
                .from("support_tickets")
                .update({
                    thread_id: threadId,
                    customer_id: customerId ?? null,
                    channel: messagingChannel,
                })
                .eq("id", byPhone.id);
            return {
                threadUpdated: true,
                ticketCreated: false,
                ticketId: byPhone.id as string,
            };
        }
    }

    const { data: ticket, error: ticketErr } = await admin
        .from("support_tickets")
        .insert({
            company_id: companyId,
            customer_phone: phone,
            customer_id: customerId ?? null,
            thread_id: threadId,
            channel: messagingChannel,
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
