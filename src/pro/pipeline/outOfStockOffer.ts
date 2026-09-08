/**
 * Oferta HITL quando o prepare/checkout não pode vender o item:
 * só para `vender_com_estoque_zero === false` + estoque insuficiente.
 * Com flag true (default do banco), vende sem avisar o cliente.
 */
import { canFulfillQty } from "@/lib/products/stockPolicy";
import { roundBrl } from "@/lib/chatbot/utils";
import type { DraftItem, OrderDraft } from "@/src/types/contracts";

export type OutOfStockOffer = {
    names: string[];
};

/** Item que a política da loja impede vender (flag false + estoque insuficiente). */
export function isBlockedOutOfStockItem(
    item: Pick<DraftItem, "estoqueUnidades" | "quantity" | "fatorConversao" | "venderComEstoqueZero">
): boolean {
    return !canFulfillQty({
        venderComEstoqueZero: item.venderComEstoqueZero,
        estoqueUnidades: item.estoqueUnidades,
        fatorConversao: item.fatorConversao,
        qty: item.quantity,
    });
}

export function listBlockedOutOfStockItems(items: readonly DraftItem[]): DraftItem[] {
    return items.filter(isBlockedOutOfStockItem);
}

export function recalculateDraftItemTotals(draft: OrderDraft): OrderDraft {
    const totalItems = roundBrl(
        draft.items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0)
    );
    const fee =
        draft.fulfillmentType === "pickup" ? 0 : Number(draft.deliveryFee ?? 0);
    return {
        ...draft,
        totalItems,
        grandTotal: roundBrl(totalItems + fee),
        pendingConfirmation: false,
    };
}

/**
 * Remove linhas bloqueadas por estoque (flag false). Mantém quem pode vender
 * zerado ou quem tem estoque. Devolve draft recalculado (ou null se vazio).
 */
export function stripBlockedOutOfStockFromDraft(draft: OrderDraft): {
    draft: OrderDraft | null;
    removedNames: string[];
} {
    const oos = listBlockedOutOfStockItems(draft.items);
    if (!oos.length) {
        return { draft, removedNames: [] };
    }
    const removedNames = [
        ...new Set(
            oos
                .map((i) => String(i.productName ?? "").trim())
                .filter((n) => n.length > 0)
        ),
    ];
    const kept = draft.items.filter((i) => !isBlockedOutOfStockItem(i));
    if (!kept.length) {
        return { draft: null, removedNames };
    }
    return {
        draft: recalculateDraftItemTotals({ ...draft, items: kept }),
        removedNames,
    };
}

/** @deprecated Prefer stripBlockedOutOfStockFromDraft — alias de compat. */
export const stripPhysicallyOutOfStockFromDraft = stripBlockedOutOfStockFromDraft;

export function formatOutOfStockOfferText(names: readonly string[]): string {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) {
        return "No momento estamos sem esse produto. Deseja adicionar outro produto?";
    }
    if (clean.length === 1) {
        return `No momento estamos sem ${clean[0]}. Deseja adicionar outro produto?`;
    }
    if (clean.length === 2) {
        return `No momento estamos sem ${clean[0]} e ${clean[1]}. Deseja adicionar outro produto?`;
    }
    const head = clean.slice(0, -1).join(", ");
    const last = clean[clean.length - 1]!;
    return `No momento estamos sem ${head} e ${last}. Deseja adicionar outro produto?`;
}

export function buildOutOfStockOfferButtons(names: readonly string[]) {
    return {
        kind: "buttons" as const,
        text: formatOutOfStockOfferText(names),
        buttons: [
            { id: "pro_oos_add_other", title: "Sim" },
            { id: "pro_oos_continue", title: "Não" },
        ],
    };
}

/** Extrai nomes de erros canónicos de prepare (`Estoque insuficiente para "X"`). */
export function parseOutOfStockNamesFromPrepareErrors(errors: readonly string[]): string[] {
    const names: string[] = [];
    for (const e of errors) {
        const m = /Estoque insuficiente para "([^"]+)"/u.exec(e);
        if (m?.[1]?.trim()) names.push(m[1].trim());
    }
    return [...new Set(names)];
}
