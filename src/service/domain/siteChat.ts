export const SITE_CHAT_MESSAGE_CAP = 8;

export const SITE_CHAT_TEXT_MAX = 500;

export const SITE_CHAT_IP_LIMIT = 30;

export const SITE_CHAT_IP_WINDOW_MS = 60 * 60 * 1000;

export const SITE_CHAT_COOKIE = "zampell_site_chat";

export const SITE_CHAT_PAGE_ORIGIN = "https://www.zampell.com.br";

export function siteChatPageUrl(key: string): string {
    return `${SITE_CHAT_PAGE_ORIGIN}/chat/${key}`;
}

export function siteChatReplies(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const replies: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const text = item.replace(/\s+/gu, " ").trim();
        if (text.length < 1 || text.length > 80 || replies.includes(text)) continue;
        replies.push(text);
        if (replies.length >= 3) break;
    }
    return replies;
}

export const SITE_CHAT_SESSION_CAP_TEXT =
    "Esta conversa chegou no limite de 8 mensagens. Abra uma nova para continuar.";

export const SITE_CHAT_IP_CAP_TEXT =
    "Muitas mensagens neste momento. Tente de novo em alguns minutos.";

export type SiteChatRole = "user" | "assistant";

export type SiteChatLink = {
    label: string;
    url: string;
};

export type SiteChatPriorTurn = {
    role: SiteChatRole;
    text: string;
};

