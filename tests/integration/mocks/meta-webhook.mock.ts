/**
 * tests/integration/mocks/meta-webhook.mock.ts
 *
 * Replica exata do JSON de Webhook da Meta WhatsApp Cloud API.
 * Documentação oficial:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 *
 * Uso: importe os builders para gerar payloads e use extractBodyText para
 * replicar o mesmo parsing que app/api/whatsapp/incoming/route.ts faz.
 */

// ─── Tipos espelho do payload Meta ───────────────────────────────────────────

export interface MetaContact {
    profile: { name: string };
    wa_id: string;
}

export interface MetaTextMessage {
    from: string;
    id: string;
    timestamp: string;
    type: "text";
    text: { body: string };
}

export interface MetaButtonReplyMessage {
    from: string;
    id: string;
    timestamp: string;
    type: "interactive";
    interactive: {
        type: "button_reply";
        button_reply: { id: string; title: string };
    };
}

export interface MetaListReplyMessage {
    from: string;
    id: string;
    timestamp: string;
    type: "interactive";
    interactive: {
        type: "list_reply";
        list_reply: { id: string; title: string; description?: string };
    };
}

export interface MetaButtonMessage {
    from: string;
    id: string;
    timestamp: string;
    type: "button";
    button: { text: string; payload: string };
}

export type MetaMessage =
    | MetaTextMessage
    | MetaButtonReplyMessage
    | MetaListReplyMessage
    | MetaButtonMessage;

export interface MetaWebhookPayload {
    object: string;
    entry: Array<{
        id: string;
        changes: Array<{
            value: {
                messaging_product: string;
                metadata: { display_phone_number: string; phone_number_id: string };
                contacts: MetaContact[];
                messages: MetaMessage[];
                statuses?: unknown[];
            };
            field: string;
        }>;
    }>;
}

// ─── Builder interno ──────────────────────────────────────────────────────────

function buildPayload(
    message: MetaMessage,
    profileName = "Cliente Teste",
    phoneNumber = "5565999990000",
): MetaWebhookPayload {
    return {
        object: "whatsapp_business_account",
        entry: [{
            id: "ENTRY_123456789",
            changes: [{
                value: {
                    messaging_product: "whatsapp",
                    metadata: {
                        display_phone_number: "15550001234",
                        phone_number_id:      "PHONE_NUMBER_ID_TEST",
                    },
                    contacts: [{ profile: { name: profileName }, wa_id: phoneNumber }],
                    messages: [message],
                },
                field: "messages",
            }],
        }],
    };
}

// ─── Payloads prontos (builders exportados) ───────────────────────────────────

/** Mensagem de texto simples — o tipo mais comum */
export function textMessagePayload(
    text: string,
    opts: { messageId?: string; profileName?: string; phone?: string } = {},
): MetaWebhookPayload {
    return buildPayload(
        {
            from:      opts.phone      ?? "5565999990000",
            id:        opts.messageId  ?? `wamid.TEST_TEXT_${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type:      "text",
            text:      { body: text },
        },
        opts.profileName ?? "Cliente Teste",
        opts.phone ?? "5565999990000",
    );
}

/** Usuário clicou em um botão interativo (sendInteractiveButtons) */
export function buttonClickPayload(
    id: string,
    title: string,
    opts: { messageId?: string; profileName?: string } = {},
): MetaWebhookPayload {
    return buildPayload(
        {
            from:      "5565999990000",
            id:        opts.messageId ?? `wamid.TEST_BTN_${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type:      "interactive",
            interactive: { type: "button_reply", button_reply: { id, title } },
        },
        opts.profileName ?? "Cliente Teste",
    );
}

/** Usuário selecionou item de lista (sendListMessage) */
export function listReplyPayload(
    id: string,
    title: string,
    opts: { messageId?: string; description?: string } = {},
): MetaWebhookPayload {
    return buildPayload({
        from:      "5565999990000",
        id:        opts.messageId ?? `wamid.TEST_LIST_${Date.now()}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type:      "interactive",
        interactive: {
            type:       "list_reply",
            list_reply: { id, title, description: opts.description },
        },
    });
}

/** Payload legado com botão tipo "button" (templates antigos da Meta) */
export function legacyButtonPayload(
    text: string,
    payload = "PAYLOAD",
    messageId?: string,
): MetaWebhookPayload {
    return buildPayload({
        from:      "5565999990000",
        id:        messageId ?? `wamid.TEST_LBTN_${Date.now()}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type:      "button",
        button:    { text, payload },
    });
}

// ─── Payloads de edge-case ────────────────────────────────────────────────────

/** Payload sem mensagens (Meta às vezes envia só status callbacks) */
export const emptyMessagesPayload: MetaWebhookPayload = {
    object: "whatsapp_business_account",
    entry: [{
        id: "ENTRY_EMPTY",
        changes: [{
            value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550001234", phone_number_id: "PHONE_ID" },
                contacts: [],
                messages: [],
            },
            field: "messages",
        }],
    }],
};

/** Payload de objeto errado (Instagram, não WhatsApp) — deve ser ignorado pela rota */
export const wrongObjectPayload = {
    object: "instagram_business_account",
    entry: [],
};

/** Payload de status callback (delivered, read) — sem messages */
export const statusCallbackPayload: MetaWebhookPayload = {
    object: "whatsapp_business_account",
    entry: [{
        id: "ENTRY_STATUS",
        changes: [{
            value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550001234", phone_number_id: "PHONE_ID" },
                contacts: [],
                messages: [],
                statuses: [{
                    id:        "wamid.SENT001",
                    status:    "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: "5565999990000",
                }],
            },
            field: "messages",
        }],
    }],
};

// ─── Extrator de bodyText (replica EXATA da lógica em incoming/route.ts) ──────

/**
 * Extrai o bodyText do payload da mesma forma que a rota faz.
 * Usar nos testes para validar que o parsing está correto antes de
 * chamar processInboundMessage.
 *
 * Fonte: app/api/whatsapp/incoming/route.ts linhas 109-122
 */
export function extractBodyText(payload: MetaWebhookPayload): string {
    const msg = payload.entry[0]?.changes[0]?.value?.messages?.[0];
    if (!msg) return "";

    const msgType = msg.type;

    if (msgType === "text") {
        return (msg as MetaTextMessage).text?.body ?? "";
    }

    if (msgType === "interactive") {
        const im = (msg as MetaButtonReplyMessage | MetaListReplyMessage).interactive;
        if (im.type === "button_reply") {
            return (im as MetaButtonReplyMessage["interactive"]).button_reply?.id
                ?? (im as MetaButtonReplyMessage["interactive"]).button_reply?.title
                ?? "";
        }
        if (im.type === "list_reply") {
            return (im as MetaListReplyMessage["interactive"]).list_reply?.id
                ?? (im as MetaListReplyMessage["interactive"]).list_reply?.title
                ?? "";
        }
    }

    if (msgType === "button") {
        return (msg as MetaButtonMessage).button?.text ?? "";
    }

    return "";
}

/** Extrai dados do contato (phoneE164, profileName) — replica lógica da rota */
export function extractContact(payload: MetaWebhookPayload): {
    phoneE164:   string;
    profileName: string | null;
    messageId:   string;
    from:        string;
} {
    const value   = payload.entry[0]?.changes[0]?.value;
    const msg     = value?.messages?.[0];
    const contact = value?.contacts?.find((c) => c.wa_id === msg?.from);

    const from       = msg?.from ?? "";
    const phoneE164  = from.startsWith("+") ? from : `+${from}`;
    const profileName = contact?.profile?.name ?? null;
    const messageId   = msg?.id ?? "";

    return { phoneE164, profileName, messageId, from };
}
