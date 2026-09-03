/**
 * lib/whatsapp/sendAndPersist.ts
 *
 * Envia via Graph API e persiste outbound em `whatsapp_messages` + preview da
 * thread — reutilizável fora do pipeline PRO (HITL send-confirmation, etc.).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    sendInteractiveButtons,
    sendWhatsAppMessage,
    type WaConfig,
} from "@/lib/whatsapp/send";

async function persistOutboundRow(
    admin: SupabaseClient,
    params: {
        threadId: string;
        phoneE164: string;
        body: string;
        waConfig?: WaConfig;
        senderType: "human" | "bot";
        result: { ok: boolean; messageId?: string; error?: string };
        rawPayload?: Record<string, unknown>;
    }
): Promise<void> {
    const fromAddr = params.waConfig?.phoneNumberId
        ? `whatsapp:${params.waConfig.phoneNumberId}`
        : "whatsapp";
    const { error: insertErr } = await admin.from("whatsapp_messages").insert({
        thread_id: params.threadId,
        direction: "outbound",
        channel: "whatsapp",
        provider: "meta",
        provider_message_id: params.result.messageId ?? null,
        from_addr: fromAddr,
        to_addr: params.phoneE164 || fromAddr,
        body: params.body,
        num_media: 0,
        status: params.result.ok ? "sent" : "failed",
        sender_type: params.senderType,
        error: params.result.ok ? null : (params.result.error ?? null),
        ...(params.rawPayload ? { raw_payload: params.rawPayload } : {}),
    });
    if (insertErr) {
        console.error("[sendAndPersist] whatsapp_messages insert failed:", insertErr.message);
    }

    if (params.result.ok) {
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: params.body.slice(0, 120),
            })
            .eq("id", params.threadId);
    }
}

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
    await persistOutboundRow(admin, {
        threadId,
        phoneE164,
        body: text,
        waConfig,
        senderType,
        result,
    });
    return result;
}

/** Interactive buttons (HITL confirmação de pedido — ADR-0005 C1). */
export async function sendAndPersistWaButtons(
    admin: SupabaseClient,
    params: {
        threadId: string;
        phoneE164: string;
        bodyText: string;
        buttons: Array<{ id: string; title: string }>;
        waConfig?: WaConfig;
        senderType?: "human" | "bot";
    }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
    const {
        threadId,
        phoneE164,
        bodyText,
        buttons,
        waConfig,
        senderType = "human",
    } = params;

    const result = await sendInteractiveButtons(phoneE164, bodyText, buttons, waConfig);
    await persistOutboundRow(admin, {
        threadId,
        phoneE164,
        body: bodyText,
        waConfig,
        senderType,
        result,
        rawPayload: { kind: "buttons", buttons },
    });
    return result;
}
