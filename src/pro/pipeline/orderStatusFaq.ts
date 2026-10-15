/**
 * FAQ de status de pedidos — resposta determinística (sem LLM).
 * Uma frase do pedido aberto, ou até três linhas em "meus pedidos".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyDeliveryEtaMin } from "@/lib/delivery/policy";
import {
    publicMenuOrderCode,
    publicMenuOrderStatusLabel,
} from "@/lib/public-menu/checkout/orderStatusLabel";

const STATUS_RE =
    /\b(?:status|cad[eê]|onde\s+est[aá]|acompanhar|previs[aã]o|meu\s+pedido|meus\s+pedidos)\b/iu;

export function looksLikeOrderStatusQuestion(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 100) return false;
    if (/^(?:btn_status)$/iu.test(t)) return true;
    return STATUS_RE.test(t);
}

/** Botão "Meus pedidos" ou a frase no plural. O resto é uma frase do pedido aberto. */
export function wantsRecentOrdersList(text: string): boolean {
    const t = text.trim();
    if (/^(?:btn_status)$/iu.test(t)) return true;
    return /\bmeus\s+pedidos\b/iu.test(t);
}

export type StatusOrderRow = {
    id: string;
    status: string;
    confirmationStatus: string | null;
    fulfillmentType: string | null;
};

export function orderStatusIsOpen(status: string, confirmationStatus: string | null): boolean {
    const label = publicMenuOrderStatusLabel(status, confirmationStatus);
    return label !== "Cancelado" && label !== "Finalizado";
}

function etaClause(order: StatusOrderRow, etaMin: number | null): string {
    if (!orderStatusIsOpen(order.status, order.confirmationStatus)) return "";
    if (String(order.fulfillmentType ?? "").toLowerCase() === "pickup") return "";
    if (etaMin == null || !Number.isFinite(etaMin)) return "";
    const minutes = Math.max(0, Math.floor(etaMin));
    return `, previsão de ${minutes} min`;
}

function statusLine(order: StatusOrderRow, etaMin: number | null): string {
    const code = publicMenuOrderCode(order.id);
    const label = publicMenuOrderStatusLabel(order.status, order.confirmationStatus);
    return `${code}: *${label}*${etaClause(order, etaMin)}`;
}

/**
 * Corpo da resposta. `list` = até 3 pedidos. Sem lista = uma frase do aberto
 * mais recente; se só houver encerrado, diz que não há pedido em andamento.
 */
export function formatOrderStatusBody(params: {
    orders: readonly StatusOrderRow[];
    list: boolean;
    etaMin: number | null;
    ordersMenuUrl?: string | null;
}): string | null {
    const orders = params.orders.slice(0, 3);
    if (!orders.length) return null;

    let body: string;
    if (params.list) {
        const lines = orders.map((order) => `• ${statusLine(order, params.etaMin)}`);
        body = `Seus pedidos recentes:\n${lines.join("\n")}`;
    } else {
        const open = orders.find((order) =>
            orderStatusIsOpen(order.status, order.confirmationStatus)
        );
        if (open) {
            const code = publicMenuOrderCode(open.id);
            const label = publicMenuOrderStatusLabel(open.status, open.confirmationStatus);
            body = `Seu pedido ${code} está *${label}*${etaClause(open, params.etaMin)}.`;
        } else {
            const last = orders[0]!;
            body = `Não há pedido em andamento. O último foi ${statusLine(last, null)}.`;
        }
    }

    const url = params.ordersMenuUrl?.trim();
    if (url) body += `\n\nAcompanhe em: ${url}`;
    return body;
}

type OrderQueryRow = {
    id: string;
    status: string;
    confirmation_status: string | null;
    fulfillment_type: string | null;
    created_at: string;
};

/**
 * Resposta de status. Null se não houver customerId ou pedidos.
 * A previsão é a da loja (`companies.settings.delivery_est_minutes`), só no pedido
 * aberto de entrega — o pedido não grava ETA próprio.
 */
export async function tryBuildOrderStatusReply(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null | undefined;
    userText?: string | null;
    ordersMenuUrl?: string | null;
}): Promise<string | null> {
    const customerId = String(params.customerId ?? "").trim();
    if (!customerId) return null;

    const { data, error } = await params.admin
        .from("orders")
        .select("id, status, confirmation_status, fulfillment_type, created_at")
        .eq("company_id", params.companyId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(3);

    if (error || !data?.length) return null;

    const orders: StatusOrderRow[] = (data as OrderQueryRow[]).map((row) => ({
        id: row.id,
        status: row.status,
        confirmationStatus: row.confirmation_status,
        fulfillmentType: row.fulfillment_type,
    }));
    const list = wantsRecentOrdersList(params.userText ?? "");
    const needsEta = orders.some(
        (order) =>
            orderStatusIsOpen(order.status, order.confirmationStatus) &&
            String(order.fulfillmentType ?? "").toLowerCase() !== "pickup"
    );
    const etaMin = needsEta ? await getCompanyDeliveryEtaMin(params.admin, params.companyId) : null;

    return formatOrderStatusBody({
        orders,
        list,
        etaMin,
        ordersMenuUrl: params.ordersMenuUrl,
    });
}
