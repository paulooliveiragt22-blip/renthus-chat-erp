/**
 * Mensagens editáveis do chatbot / WhatsApp operacional.
 * Instruções fixas do menu e botões NÃO são editáveis (só o texto de saudação).
 */

export type ChatbotMessageTemplateKey =
    | "msg_welcome_returning"
    | "msg_welcome_first"
    | "msg_out_for_delivery"
    | "msg_thank_you";

export type ChatbotMessageTemplates = Record<ChatbotMessageTemplateKey, string>;

/** Instruções anexadas após a saudação (não editáveis na UI). */
export const WELCOME_INSTRUCTIONS_RETURNING =
    "\n\nUse os botões abaixo: continuar o pedido no chat, ver seus pedidos ou falar com um atendente. O cardápio web fica no botão Abrir cardápio.";

export const WELCOME_INSTRUCTIONS_FIRST =
    "\n\nUse os botões abaixo: continuar o pedido no chat, ver seus pedidos ou falar com um atendente. O cardápio web fica no botão Abrir cardápio.";

export const DEFAULT_CHATBOT_MESSAGE_TEMPLATES: ChatbotMessageTemplates = {
    msg_welcome_returning:
        "Bem-vindo de volta! Posso agilizar seu pedido com seus dados salvos.",
    msg_welcome_first: "Oi! Sou o assistente da loja e te ajudo a fechar o pedido por aqui.",
    msg_out_for_delivery:
        "Ótima notícia{nome_parte}: seu pedido já está com nosso entregador e a caminho de você! 🛵💨",
    msg_thank_you:
        "Confirmamos que seu pedido foi entregue{nome_parte}! 🎉 Esperamos que tenha chegado tudo certinho. Qualquer coisa, é só chamar!",
};

const KEYS: ChatbotMessageTemplateKey[] = [
    "msg_welcome_returning",
    "msg_welcome_first",
    "msg_out_for_delivery",
    "msg_thank_you",
];

/** Compat: chaves antigas do inbound legado PRO. */
function legacyGreeting(
    cfg: Record<string, unknown>,
    key: "msg_welcome_first" | "msg_welcome_returning"
): string {
    if (key === "msg_welcome_first") {
        return String(cfg.pro_greeting_first_contact ?? "").trim();
    }
    return String(cfg.pro_greeting_routine ?? "").trim();
}

export function resolveChatbotMessageTemplates(
    botConfig: Record<string, unknown> | null | undefined
): ChatbotMessageTemplates {
    const cfg = botConfig ?? {};
    const out = { ...DEFAULT_CHATBOT_MESSAGE_TEMPLATES };
    for (const key of KEYS) {
        const raw = String(cfg[key] ?? "").trim();
        if (raw) {
            out[key] = raw;
            continue;
        }
        if (key === "msg_welcome_first" || key === "msg_welcome_returning") {
            const legacy = legacyGreeting(cfg, key);
            if (legacy) out[key] = legacy;
        }
    }
    return out;
}

/** Placeholders: `{nome}`, `{nome_parte}` (`, Nome` ou vazio), `{empresa}`. */
export function applyChatbotMessageTemplate(
    tpl: string,
    vars: { customerName?: string | null; companyName?: string | null }
): string {
    const name = (vars.customerName ?? "").trim();
    const nomeParte = name ? `, ${name}` : "";
    const empresa = (vars.companyName ?? "").trim() || "nossa loja";
    return tpl
        .replaceAll("{nome_parte}", nomeParte)
        .replaceAll("{nome}", name || "cliente")
        .replaceAll("{empresa}", empresa);
}

export function buildWelcomeMenuBody(
    isReturningCustomer: boolean,
    templates?: ChatbotMessageTemplates | null
): string {
    const t = templates ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES;
    if (isReturningCustomer) {
        return t.msg_welcome_returning.trim() + WELCOME_INSTRUCTIONS_RETURNING;
    }
    return t.msg_welcome_first.trim() + WELCOME_INSTRUCTIONS_FIRST;
}

export function mergeMessageTemplatesIntoBotConfig(
    existing: Record<string, unknown>,
    templates: Partial<ChatbotMessageTemplates>
): Record<string, unknown> {
    const next = { ...existing };
    for (const key of KEYS) {
        if (templates[key] === undefined) continue;
        const trimmed = String(templates[key] ?? "").trim();
        next[key] = trimmed || DEFAULT_CHATBOT_MESSAGE_TEMPLATES[key];
    }
    return next;
}
