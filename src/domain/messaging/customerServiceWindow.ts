/**
 * Política de janela de atendimento Meta (domínio).
 * WA: fora da janela só HSM (não tratado aqui).
 * IG/Messenger: fora da janela = silêncio do bot (B4); sem HSM.
 */

import type { MessagingChannel } from "@/src/domain/contracts/identity";

export const CUSTOMER_SERVICE_WINDOW_HOURS = 24;
export const CUSTOMER_SERVICE_WINDOW_MS = CUSTOMER_SERVICE_WINDOW_HOURS * 3_600_000;

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

export function isCustomerServiceWindowClosing(
    lastInboundAt: string | Date | null | undefined,
    nowMs: number = Date.now(),
    thresholdHours = 20
): boolean {
    const hours = hoursSinceLastInbound(lastInboundAt, nowMs);
    if (hours === null) return false;
    return hours >= thresholdHours && hours < CUSTOMER_SERVICE_WINDOW_HOURS;
}

export type FreeFormSendPolicy = {
    /** Bot/automação pode enviar free-form agora. */
    allowAutomated: boolean;
    /** Operador humano com tag HUMAN_AGENT (só inbox) — fora do escopo do bot. */
    allowHumanAgentTag: boolean;
    reason: "within_window" | "outside_window" | "no_inbound";
};

/**
 * Decisão B4: IG/Messenger fora da 24h → bot silencia.
 * WhatsApp fora da 24h → bot não envia free-form (HSM é outro caminho).
 */
export function resolveFreeFormSendPolicy(params: {
    channel: MessagingChannel | "whatsapp" | "instagram" | "messenger" | "web";
    lastInboundAt: string | Date | null | undefined;
    nowMs?: number;
}): FreeFormSendPolicy {
    const nowMs = params.nowMs ?? Date.now();
    const within = isWithinCustomerServiceWindow(params.lastInboundAt, nowMs);
    if (!params.lastInboundAt) {
        return {
            allowAutomated: false,
            allowHumanAgentTag: params.channel !== "whatsapp",
            reason: "no_inbound",
        };
    }
    if (within) {
        return {
            allowAutomated: true,
            allowHumanAgentTag: false,
            reason: "within_window",
        };
    }
    return {
        allowAutomated: false,
        // Meta: Message Tag HUMAN_AGENT ~7d — só humano na inbox; bot nunca.
        allowHumanAgentTag: params.channel === "instagram" || params.channel === "messenger",
        reason: "outside_window",
    };
}
