/**
 * Alerta operacional do admin (pedido / handover chat).
 * Deep-link first — a UI só navega; páginas abrem modal/conversa.
 */

export const ADMIN_ALERT_KINDS = ["order_new", "chat_handover"] as const;
export type AdminAlertKind = (typeof ADMIN_ALERT_KINDS)[number];

export type AdminAlert = {
    /** Chave estável p/ dedupe (ex.: order id ou handover:threadId:at). */
    id: string;
    kind: AdminAlertKind;
    title: string;
    description: string;
    /** Path canônico in-app (ex.: /pedidos?open=…). */
    href: string;
    createdAt: string;
    /** Texto do botão de ação (a11y). */
    actionLabel: string;
};

export function orderAlertCode(orderId: string): string {
    return `#${orderId.replaceAll("-", "").slice(-6).toUpperCase()}`;
}

export function orderSourceLabel(source: string | null): string {
    if (source === "web_menu") return "Cardápio web";
    if (source === "flow_catalog" || source === "flow_checkout") return "WhatsApp Flow";
    if (source === "ai_chat_pro_v2" || source === "chatbot") return "WhatsApp";
    if (source === "marketplace_ifood") return "iFood";
    if (source === "marketplace_aiqfome") return "Aiqfome";
    if (source === "pdv_direct") return "PDV";
    if (source === "ui") return "Painel";
    return "Novo pedido";
}

export function channelLabel(channel: string | null | undefined): string {
    const c = String(channel ?? "whatsapp").toLowerCase();
    if (c === "instagram") return "Instagram";
    if (c === "messenger") return "Messenger";
    if (c === "web") return "Web";
    return "WhatsApp";
}
