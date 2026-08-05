/**
 * Mensagem de recuperação de carrinho — montada só a partir do snapshot do
 * rascunho, sem passar por IA: valores em R$ não podem ser improvisados pelo
 * modelo e a mensagem precisa ser barata e previsível.
 */

import type { OutboundJobPayload } from "./types";

/** Retoma o checkout do rascunho já existente na sessão. */
export const CART_RECOVERY_BUTTON_ID = "pro_recover_cart";

export interface CartSnapshotItem {
    productName?: unknown;
    quantity?: unknown;
}

export interface CartSnapshot {
    items?: unknown;
    grandTotal?: unknown;
    deliveryFee?: unknown;
}

function moneyBr(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

function toFiniteNumber(value: unknown): number | null {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeItems(raw: unknown): Array<{ name: string; quantity: number }> {
    if (!Array.isArray(raw)) return [];
    const items: Array<{ name: string; quantity: number }> = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as CartSnapshotItem;
        const name = String(item.productName ?? "").trim();
        const quantity = toFiniteNumber(item.quantity) ?? 0;
        if (!name || quantity <= 0) continue;
        items.push({ name, quantity });
    }
    return items;
}

function summarizeItems(items: Array<{ name: string; quantity: number }>): string {
    const shown = items.slice(0, 3).map((i) => `${i.quantity}x ${i.name}`);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(rest === 1 ? "e mais 1 item" : `e mais ${rest} itens`);
    return shown.join("\n");
}

function firstName(customerName: string | null | undefined): string {
    const trimmed = String(customerName ?? "").trim();
    if (!trimmed) return "";
    return trimmed.split(/\s+/u)[0] ?? "";
}

/**
 * `null` quando o snapshot não tem item válido — o worker trata como job a
 * descartar em vez de mandar mensagem vazia ao cliente.
 */
export function buildCartRecoveryMessage(params: {
    draft: CartSnapshot | null | undefined;
    customerName?: string | null;
}): OutboundJobPayload | null {
    const items = normalizeItems(params.draft?.items);
    if (items.length === 0) return null;

    const name = firstName(params.customerName);
    const greeting = name ? `${name}, seu pedido ficou pela metade.` : "Seu pedido ficou pela metade.";

    const lines = [greeting, "", summarizeItems(items)];

    const deliveryFee = toFiniteNumber(params.draft?.deliveryFee);
    const grandTotal = toFiniteNumber(params.draft?.grandTotal);
    if (grandTotal !== null && grandTotal > 0) {
        const feePart = deliveryFee !== null && deliveryFee > 0 ? ` (com taxa de R$ ${moneyBr(deliveryFee)})` : "";
        lines.push("", `Total: R$ ${moneyBr(grandTotal)}${feePart}`);
    }
    lines.push("", "Quer finalizar agora?");

    return {
        kind: "buttons",
        text: lines.join("\n"),
        buttons: [
            { id: CART_RECOVERY_BUTTON_ID, title: "Finalizar pedido" },
            { id: "pro_add_items", title: "Adicionar mais" },
            { id: "pro_cancel_order", title: "Cancelar" },
        ],
    };
}
