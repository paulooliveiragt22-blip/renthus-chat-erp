import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminAlert } from "../domain/AdminAlert";
import { orderAlertCode, orderSourceLabel, channelLabel } from "../domain/AdminAlert";
import { orderOpenHref, threadOpenHref } from "../domain/AlertDeepLink";
import { dispatchCompanyPush } from "../adapters/webPushSender";

/** Dispara Web Push sem bloquear a request (app fechado / PWA). */
export function fireCompanyAlertPush(
    admin: SupabaseClient,
    companyId: string,
    alert: Pick<AdminAlert, "id" | "title" | "description" | "href">
): void {
    void dispatchCompanyPush(admin, companyId, alert).catch(() => {
        /* ignore push failures */
    });
}

export function buildOrderNewPushAlert(input: {
    orderId: string;
    source?: string | null;
    totalAmount?: number;
}): Pick<AdminAlert, "id" | "title" | "description" | "href"> {
    const total =
        input.totalAmount != null
            ? input.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
            : "";
    return {
        id: `order:${input.orderId}`,
        title: `Pedido ${orderAlertCode(input.orderId)}`,
        description: [orderSourceLabel(input.source ?? null), total].filter(Boolean).join(" · "),
        href: orderOpenHref(input.orderId),
    };
}

export function buildHandoverPushAlert(input: {
    threadId: string;
    handoverAt: string;
    channel?: string | null;
    profileName?: string | null;
    reason?: string | null;
}): Pick<AdminAlert, "id" | "title" | "description" | "href"> {
    const ch = channelLabel(input.channel);
    const who = (input.profileName ?? "Cliente").trim() || "Cliente";
    return {
        id: `handover:${input.threadId}:${input.handoverAt}`,
        title: `Atendimento humano · ${ch}`,
        description: `${who} — ${(input.reason ?? "Solicitou atendimento humano").trim()}`,
        href: threadOpenHref(input.threadId),
    };
}
