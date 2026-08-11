/**
 * lib/whatsapp/sendAndPersist.ts
 *
 * Envia texto via Graph API (`sendWhatsAppMessage`) e persiste o outbound em
 * `whatsapp_messages` + atualiza o preview da thread — mesmo padrão de
 * `WhatsAppMessageGateway.persistOutbound` (src/pro/adapters/whatsapp), mas
 * reutilizável fora do pipeline PRO (ex.: fluxo de confirmação de pedido
 * disparado pelo atendente ou resolvido deterministicamente em process-queue).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";

export async function sendAndPersistWaText(
    admin: SupabaseClient,
    params: {
        threadId: string;
        phoneE164: string;
        text: string;
        waConfig?: WaConfig;
        /** Default 'human' (mesma convenção de /api/whatsapp/send: mensagem iniciada por gente/admin). */
        senderType?: "human" | "bot";
    }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
    const { threadId, phoneE164, text, waConfig, senderType = "human" } = params;

    const result = await sendWhatsAppMessage(phoneE164, text, waConfig);

    const fromAddr = waConfig?.phoneNumberId ? `whatsapp:${waConfig.phoneNumberId}` : "whatsapp";
    const { error: insertErr } = await admin.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "outbound",
        channel: "whatsapp",
        provider: "meta",
        provider_message_id: result.messageId ?? null,
        from_addr: fromAddr,
        to_addr: phoneE164 || fromAddr,
        body: text,
        num_media: 0,
        status: result.ok ? "sent" : "failed",
        sender_type: senderType,
        error: result.ok ? null : (result.error ?? null),
    });
    if (insertErr) {
        console.error("[sendAndPersist] whatsapp_messages insert failed:", insertErr.message);
    }

    if (result.ok) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: text.slice(0, 120),
            })
            .eq("id", threadId);
    }

    return result;
}
