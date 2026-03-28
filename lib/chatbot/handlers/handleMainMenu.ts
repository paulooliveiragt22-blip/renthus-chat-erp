/**
 * lib/chatbot/handlers/handleMainMenu.ts
 *
 * Handover para atendente humano.
 * O menu principal agora é gerenciado diretamente pelo processMessage/intentClassifier.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";

// ─── Handover ─────────────────────────────────────────────────────────────────

export async function doHandover(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<void> {
    const clientName = (session.context?.client_name as string | undefined) ?? null;

    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId),
        saveSession(admin, threadId, companyId, { step: "handover" }),
    ]);

    // Cria ticket de suporte (evita duplicata se já existe ticket aberto)
    const { data: existing } = await admin
        .from("support_tickets")
        .select("id")
        .eq("company_id",     companyId)
        .eq("customer_phone", phoneE164)
        .in("status",         ["open", "in_progress"])
        .maybeSingle();

    if (!existing?.id) {
        await admin.from("support_tickets").insert({
            company_id:     companyId,
            customer_phone: phoneE164,
            customer_name:  clientName,
            message:        "Cliente solicitou atendimento humano via WhatsApp",
            priority:       "normal",
            status:         "open",
        });
    }

    await botReply(
        admin, companyId, threadId, phoneE164,
        `👋 Vou te conectar com um atendente do *${companyName}*.\n\n_Aguarde, alguém responderá em breve._`
    );
}
