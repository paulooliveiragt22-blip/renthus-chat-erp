/**
 * Gates de envio proativo.
 *
 * Avaliados no momento do envio, não do enfileiramento: entre enfileirar e
 * enviar o cliente pode ter fechado o pedido, um humano pode ter assumido a
 * conversa e a janela de 24h pode ter fechado.
 */

import { isWithinCustomerServiceWindow } from "@/lib/whatsapp/customerServiceWindow";
import {
    isWithinProactiveHours,
    type StoreHours,
} from "@/lib/delivery/hours";
import type { OutboundPurpose } from "./types";

export type OutboundSkipReason =
    | "empty_payload"
    | "outside_service_window"
    | "human_handover"
    | "cart_not_open"
    | "outside_business_hours"
    | "frequency_cap";

export type OutboundGateDecision = { allow: true } | { allow: false; reason: OutboundSkipReason };

/** @deprecated Preferir StoreHours de `@/lib/delivery/hours`. Alias compatível. */
export type BusinessHours = Pick<StoreHours, "openTime" | "closeTime" | "timeZone"> & {
    periods?: StoreHours["periods"];
};

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

/** Reexport — outbound usa quiet hours quando a loja ainda não cadastrou horário. */
export function isWithinBusinessHours(nowMs: number, hours: BusinessHours | null): boolean {
    return isWithinProactiveHours(nowMs, {
        periods: hours?.periods ?? [],
        openTime: hours?.openTime ?? null,
        closeTime: hours?.closeTime ?? null,
        timeZone: hours?.timeZone ?? "America/Cuiaba",
        deliveryDescription: null,
    });
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
