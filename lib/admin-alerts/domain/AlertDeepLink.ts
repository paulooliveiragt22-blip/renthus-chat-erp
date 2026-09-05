/** Paths canônicos — PedidosClient (?open=) e WhatsAppInbox (?t=). */

export function orderOpenHref(orderId: string): string {
    return `/pedidos?open=${encodeURIComponent(orderId)}`;
}

export function threadOpenHref(threadId: string): string {
    return `/whatsapp?t=${encodeURIComponent(threadId)}`;
}
