import type { DraftItem, OrderDraft } from "@/src/types/contracts";
import { roundBrl } from "@/lib/chatbot/utils";

/**
 * Une itens do prepare atual com o draft da sessão (union por `produtoEmbalagemId`).
 * Impede que uma clarificação/pick com 1 SKU apague linhas já aceitas.
 */
export function mergePreparedDraftIntoCurrent(
    current: OrderDraft | null,
    prepared: OrderDraft | null
): OrderDraft | null {
    if (!prepared) return current;
    if (!current?.items?.length) return prepared;

    const byId = new Map<string, DraftItem>();
    for (const item of current.items) {
        byId.set(item.produtoEmbalagemId, item);
    }
    for (const item of prepared.items) {
        byId.set(item.produtoEmbalagemId, item);
    }
    const items = [...byId.values()];

    const address = prepared.address ?? current.address;
    const paymentMethod = prepared.paymentMethod ?? current.paymentMethod;
    const changeFor = prepared.changeFor != null ? prepared.changeFor : current.changeFor;

    const deliveryFromPrepared = Boolean(prepared.address);
    const deliveryFee = deliveryFromPrepared ? prepared.deliveryFee : current.deliveryFee;
    const deliveryZoneId = deliveryFromPrepared ? prepared.deliveryZoneId : current.deliveryZoneId;
    const deliveryAddressText = deliveryFromPrepared
        ? prepared.deliveryAddressText
        : current.deliveryAddressText;
    const deliveryMinOrder = deliveryFromPrepared
        ? prepared.deliveryMinOrder
        : current.deliveryMinOrder;
    const deliveryEtaMin = deliveryFromPrepared
        ? prepared.deliveryEtaMin
        : current.deliveryEtaMin;

    const totalItems = roundBrl(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    const grandTotal = roundBrl(totalItems + (deliveryFee ?? 0));

    return {
        items,
        address,
        paymentMethod,
        changeFor,
        deliveryFee: deliveryFee ?? 0,
        deliveryZoneId: deliveryZoneId ?? null,
        deliveryAddressText: deliveryAddressText ?? null,
        deliveryMinOrder: deliveryMinOrder ?? null,
        deliveryEtaMin: deliveryEtaMin ?? null,
        totalItems,
        grandTotal,
        pendingConfirmation: Boolean(
            items.length && address && paymentMethod && (paymentMethod !== "cash" || changeFor != null)
        ),
        addressResolutionNote:
            prepared.addressResolutionNote ?? current.addressResolutionNote ?? null,
        version: 1,
    };
}

/** Allowlist da busca ∪ embalagens já no draft (prepare aditivo). */
export function unionAllowlistWithDraftIds(
    allowlistIds: readonly string[],
    draft: OrderDraft | null
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of allowlistIds) {
        const s = String(id ?? "").trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    for (const item of draft?.items ?? []) {
        const s = String(item.produtoEmbalagemId ?? "").trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}
