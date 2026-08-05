/**
 * Gates de envio proativo.
 *
 * Avaliados no momento do envio, não do enfileiramento: entre enfileirar e
 * enviar o cliente pode ter fechado o pedido, um humano pode ter assumido a
 * conversa e a janela de 24h pode ter fechado.
 */

import { isWithinCustomerServiceWindow } from "@/lib/whatsapp/customerServiceWindow";
import type { OutboundPurpose } from "./types";

export type OutboundSkipReason =
    | "empty_payload"
    | "outside_service_window"
    | "human_handover"
    | "cart_not_open"
    | "outside_business_hours"
    | "frequency_cap";

export type OutboundGateDecision = { allow: true } | { allow: false; reason: OutboundSkipReason };

export interface BusinessHours {
    /** `HH:MM` no fuso da loja. */
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
}

export interface OutboundGateContext {
    purpose: OutboundPurpose;
    nowMs: number;
    hasPayload: boolean;
    lastInboundAt: string | null;
    botActive: boolean | null;
    /** Estado atual do `abandoned_carts` da thread (só para `cart_recovery`). */
    cartStatus: string | null;
    /** Mensagens proativas já enviadas ao cliente na janela de frequência. */
    recentProactiveCount: number;
    maxProactivePerWindow: number;
    businessHours: BusinessHours | null;
}

/** Sem horário configurado pela loja, evita madrugada. */
const DEFAULT_QUIET_HOURS: { openMinutes: number; closeMinutes: number } = {
    openMinutes: 8 * 60,
    closeMinutes: 22 * 60,
};

function parseHhMm(value: string | null | undefined): number | null {
    const match = /^(\d{1,2}):(\d{2})$/u.exec(String(value ?? "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function minutesInTimeZone(nowMs: number, timeZone: string): number | null {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(nowMs));
        const hours = Number(parts.find((p) => p.type === "hour")?.value);
        const minutes = Number(parts.find((p) => p.type === "minute")?.value);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        return hours * 60 + minutes;
    } catch {
        return null;
    }
}

export function isWithinBusinessHours(nowMs: number, hours: BusinessHours | null): boolean {
    const timeZone = hours?.timeZone?.trim() || "America/Sao_Paulo";
    const current = minutesInTimeZone(nowMs, timeZone);
    if (current === null) return true;

    const open = parseHhMm(hours?.openTime) ?? DEFAULT_QUIET_HOURS.openMinutes;
    const close = parseHhMm(hours?.closeTime) ?? DEFAULT_QUIET_HOURS.closeMinutes;
    if (open === close) return true;

    // Janela que atravessa a meia-noite (ex.: 18:00 → 02:00).
    if (close < open) return current >= open || current < close;
    return current >= open && current < close;
}

export function evaluateOutboundGates(ctx: OutboundGateContext): OutboundGateDecision {
    if (!ctx.hasPayload) {
        return { allow: false, reason: "empty_payload" };
    }

    if (!isWithinCustomerServiceWindow(ctx.lastInboundAt, ctx.nowMs)) {
        return { allow: false, reason: "outside_service_window" };
    }

    if (ctx.botActive === false) {
        return { allow: false, reason: "human_handover" };
    }

    if (ctx.purpose === "cart_recovery" && ctx.cartStatus !== "open" && ctx.cartStatus !== "notified") {
        return { allow: false, reason: "cart_not_open" };
    }

    // Aviso de pedido não é marketing: não respeita horário nem teto de frequência.
    if (ctx.purpose === "transactional") {
        return { allow: true };
    }

    if (!isWithinBusinessHours(ctx.nowMs, ctx.businessHours)) {
        return { allow: false, reason: "outside_business_hours" };
    }

    if (ctx.recentProactiveCount >= ctx.maxProactivePerWindow) {
        return { allow: false, reason: "frequency_cap" };
    }

    return { allow: true };
}
