/**
 * Janela de atendimento do WhatsApp (Meta): 24h contadas a partir da última
 * mensagem recebida do cliente. Dentro dela a loja envia mensagem livre; fora,
 * só template (HSM) aprovado.
 *
 * A base é `whatsapp_threads.last_inbound_at`. `last_message_at` é atualizado
 * também por outbound e renovaria a janela indevidamente.
 */

export const CUSTOMER_SERVICE_WINDOW_HOURS = 24;
export const CUSTOMER_SERVICE_WINDOW_MS = CUSTOMER_SERVICE_WINDOW_HOURS * 3_600_000;

/** Horas desde o último inbound, ou `null` quando o cliente nunca escreveu. */
export function hoursSinceLastInbound(
    lastInboundAt: string | Date | null | undefined,
    nowMs: number = Date.now()
): number | null {
    if (!lastInboundAt) return null;
    const ts = lastInboundAt instanceof Date ? lastInboundAt.getTime() : Date.parse(lastInboundAt);
    if (!Number.isFinite(ts)) return null;
    return (nowMs - ts) / 3_600_000;
}

export function isWithinCustomerServiceWindow(
    lastInboundAt: string | Date | null | undefined,
    nowMs: number = Date.now()
): boolean {
    const hours = hoursSinceLastInbound(lastInboundAt, nowMs);
    if (hours === null) return false;
    return hours >= 0 && hours < CUSTOMER_SERVICE_WINDOW_HOURS;
}

/** Janela ainda aberta, mas perto de fechar — usado como aviso na inbox. */
export function isCustomerServiceWindowClosing(
    lastInboundAt: string | Date | null | undefined,
    nowMs: number = Date.now(),
    thresholdHours = 20
): boolean {
    const hours = hoursSinceLastInbound(lastInboundAt, nowMs);
    if (hours === null) return false;
    return hours >= thresholdHours && hours < CUSTOMER_SERVICE_WINDOW_HOURS;
}
