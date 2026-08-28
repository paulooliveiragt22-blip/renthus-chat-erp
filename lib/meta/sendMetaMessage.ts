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

/**
 * Botão URL (cardápio web) — template button + web_url, como CTA do WhatsApp.
 * Fallback: texto + link se Graph rejeitar.
 */
export async function sendMetaPageUrlButton(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    bodyText: string;
    buttonTitle: string;
    url: string;
}): Promise<MetaSendResult> {
    const bodyText = params.bodyText.trim() || "Toque para abrir:";
    const buttonTitle = params.buttonTitle.trim() || "Abrir";
    const url = params.url.trim();
    if (!url) return { ok: false, error: "missing_url" };
    if (!params.pageId || !params.accessToken || !params.recipientId) {
        return { ok: false, error: "missing_credentials" };
    }

    const graphUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/messages`;
    const result = await metaGraphPostJson(params.pageId, graphUrl, {
        accessToken: params.accessToken,
        body: {
            recipient: { id: params.recipientId },
            messaging_type: "RESPONSE",
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: bodyText.slice(0, 640),
                        buttons: [
                            {
                                type: "web_url",
                                title: buttonTitle.slice(0, 20),
                                url,
                            },
                        ],
                    },
                },
            },
        },
    });

    if (!result.ok) {
        console.warn("[meta/send] url_button failed, fallback text:", result.status);
        return sendMetaPageText({
            pageId: params.pageId,
            accessToken: params.accessToken,
            recipientId: params.recipientId,
            text: `${bodyText}\n\n${url}`,
        });
    }

    const messageId =
        typeof result.json.message_id === "string"
            ? result.json.message_id
            : typeof result.json.id === "string"
              ? result.json.id
              : undefined;

    return { ok: true, messageId };
}

type MetaGenericButton =
    | { type: "postback"; title: string; payload: string }
    | { type: "web_url"; title: string; url: string };

/**
 * Generic Template — melhor compatibilidade IG (Android/desktop) que quick_replies.
 */
export async function sendMetaPageGenericTemplate(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    title: string;
    subtitle?: string;
    buttons: MetaGenericButton[];
}): Promise<MetaSendResult> {
    const title = params.title.trim().slice(0, 80) || "Como posso ajudar?";
    const subtitle = params.subtitle?.trim().slice(0, 80);
    const buttons = params.buttons.slice(0, 3).map((b) => {
        if (b.type === "web_url") {
            return {
                type: "web_url",
                title: b.title.slice(0, 20),
                url: b.url.trim(),
            };
        }
        return {
            type: "postback",
            title: b.title.slice(0, 20),
            payload: b.payload.slice(0, 1000),
        };
    });

    if (!params.pageId || !params.accessToken || !params.recipientId) {
        return { ok: false, error: "missing_credentials" };
    }

    const graphUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(params.pageId)}/messages`;
    const element: Record<string, unknown> = { title, buttons };
    if (subtitle) element.subtitle = subtitle;

    const result = await metaGraphPostJson(params.pageId, graphUrl, {
        accessToken: params.accessToken,
        body: {
            recipient: { id: params.recipientId },
            messaging_type: "RESPONSE",
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: [element],
                    },
                },
            },
        },
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

/** Menu principal IG/Messenger — postbacks em card. */
export async function sendMetaPageMenuPostbacks(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    text: string;
    buttons: Array<{ id: string; title: string }>;
}): Promise<MetaSendResult> {
    const buttons = params.buttons.slice(0, 3).map((b) => ({
        type: "postback" as const,
        title: b.title,
        payload: b.id,
    }));
    if (buttons.length === 0) {
        return sendMetaPageText({
            pageId: params.pageId,
            accessToken: params.accessToken,
            recipientId: params.recipientId,
            text: params.text,
        });
    }

    const result = await sendMetaPageGenericTemplate({
        pageId: params.pageId,
        accessToken: params.accessToken,
        recipientId: params.recipientId,
        title: params.text.trim().slice(0, 80) || "Como posso ajudar?",
        subtitle: "Toque em uma opção abaixo",
        buttons,
    });

    if (result.ok) return result;

    console.warn("[meta/send] generic menu failed, fallback quick_replies:", result.error);
    return sendMetaPageQuickReplies(params);
}

/** Cardápio web — generic template com botão URL. */
export async function sendMetaPageWebUrlCard(params: {
    pageId: string;
    accessToken: string;
    recipientId: string;
    bodyText: string;
    buttonTitle: string;
    url: string;
}): Promise<MetaSendResult> {
    const bodyText = params.bodyText.trim() || "Toque para abrir:";
    const buttonTitle = params.buttonTitle.trim() || "Abrir";
    const url = params.url.trim();
    if (!url) return { ok: false, error: "missing_url" };

    const result = await sendMetaPageGenericTemplate({
        pageId: params.pageId,
        accessToken: params.accessToken,
        recipientId: params.recipientId,
        title: bodyText.slice(0, 80),
        subtitle: "Link seguro da loja",
        buttons: [{ type: "web_url", title: buttonTitle, url }],
    });

    if (result.ok) return result;

    console.warn("[meta/send] generic url card failed, fallback button template:", result.error);
    return sendMetaPageUrlButton(params);
}
