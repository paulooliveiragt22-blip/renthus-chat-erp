import "server-only";

import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v20.0";

export type MetaSendResult = {
    ok: boolean;
    messageId?: string;
    error?: string;
    status?: number;
};

export type MetaMessagingType = "RESPONSE" | "MESSAGE_TAG";

/**
 * Envia texto via Send API da Page (Messenger PSID ou Instagram IGSID).
 * Docs Meta: POST /{page-id}/messages
 * Inbox humano fora da 24h: messaging_type=MESSAGE_TAG + tag=HUMAN_AGENT (B4).
 */
export async function sendMetaPageText(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    text: string;
    messagingType?: MetaMessagingType;
    /** Só com messagingType MESSAGE_TAG (ex.: HUMAN_AGENT). */
    tag?: "HUMAN_AGENT";
}): Promise<MetaSendResult> {
    const text = params.text.trim();
    if (!text) return { ok: false, error: "empty_text" };
    if (!params.pageId || !params.accessToken || !params.recipientId) {
        return { ok: false, error: "missing_credentials" };
    }

    const messagingType = params.messagingType ?? "RESPONSE";
    const body: Record<string, unknown> = {
        recipient: { id: params.recipientId },
        messaging_type: messagingType,
        message: { text: text.slice(0, 2000) },
    };
    if (messagingType === "MESSAGE_TAG") {
        body.tag = params.tag ?? "HUMAN_AGENT";
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/messages`;
    const result = await metaGraphPostJson(params.pageId, url, {
        accessToken: params.accessToken,
        body,
    });

    if (!result.ok) {
        const errObj = result.json?.error as { message?: string } | undefined;
        return {
            ok: false,
            status: result.status,
            error: errObj?.message ?? `graph_${result.status}`,
        };
    }

    const messageId =
        typeof result.json.message_id === "string"
            ? result.json.message_id
            : typeof result.json.id === "string"
              ? result.json.id
              : undefined;

    return { ok: true, messageId };
}

/**
 * Botões rápidos Meta (até 3). Fallback: texto puro se Graph rejeitar.
 */
export async function sendMetaPageQuickReplies(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    text: string;
    buttons: Array<{ id: string; title: string }>;
}): Promise<MetaSendResult> {
    const text = params.text.trim() || "Como posso ajudar?";
    const quickReplies = params.buttons.slice(0, 3).map((b) => ({
        content_type: "text",
        title: b.title.slice(0, 20),
        payload: b.id.slice(0, 1000),
    }));

    if (quickReplies.length === 0) {
        return sendMetaPageText(params);
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/messages`;
    const result = await metaGraphPostJson(params.pageId, url, {
        accessToken: params.accessToken,
        body: {
            recipient: { id: params.recipientId },
            messaging_type: "RESPONSE",
            message: {
                text: text.slice(0, 2000),
                quick_replies: quickReplies,
            },
        },
    });

    if (!result.ok) {
        console.warn("[meta/send] quick_replies failed, fallback text:", result.status);
        return sendMetaPageText(params);
    }

    return { ok: true };
}
