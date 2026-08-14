import type { DraftItem, OrderDraft } from "@/src/types/contracts";
import { roundBrl } from "@/lib/chatbot/utils";
import { applyPickupTotals } from "@/lib/delivery/fulfillment";

function normalizeNameKey(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function productNameMatchesHint(productName: string, nameHint: string): boolean {
    const pn = normalizeNameKey(productName);
    const hint = normalizeNameKey(nameHint);
    if (!pn || !hint) return false;
    if (pn.includes(hint) || hint.includes(pn)) return true;
    const tokens = hint.split(" ").filter((t) => t.length >= 3);
    if (!tokens.length) return false;
    return tokens.every((t) => pn.includes(t));
}

function rebuildDraftTotals(draft: OrderDraft, kept: DraftItem[]): OrderDraft {
    const totalItems = roundBrl(kept.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    const deliveryFee = draft.deliveryFee ?? 0;
    const grandTotal = roundBrl(totalItems + deliveryFee);

    if (!kept.length) {
        return {
            ...draft,
            items: [],
            totalItems: 0,
            grandTotal: deliveryFee,
            pendingConfirmation: false,
        };
    }

    return {
        ...draft,
        items: kept,
        totalItems,
        grandTotal,
        pendingConfirmation: Boolean(
            kept.length &&
                draft.paymentMethod &&
                (draft.paymentMethod !== "cash" || draft.changeFor != null) &&
                (draft.fulfillmentType === "pickup" || draft.address)
        ),
    };
}

/**
 * Remove linhas do draft cujo nome casa com o hint (ex.: "salgadinho" → UN e CX).
 * Usado em troca/substituição antes de acrescentar o SKU novo.
 */
export function removeDraftItemsMatchingName(
    draft: OrderDraft | null,
    nameHint: string
): OrderDraft | null {
    if (!draft?.items?.length) return draft;
    const kept = draft.items.filter((it) => !productNameMatchesHint(it.productName, nameHint));
    if (kept.length === draft.items.length) return draft;
    return rebuildDraftTotals(draft, kept);
}

/**
 * Após troca: remove linhas que casam com o hint, exceto os IDs do substituto
 * (CX também contém "salgadinho" no nome).
 */
export function removeDraftItemsMatchingNameExcept(
    draft: OrderDraft | null,
    nameHint: string,
    keepEmbalagemIds: readonly string[]
): OrderDraft | null {
    if (!draft?.items?.length) return draft;
    const keep = new Set(keepEmbalagemIds.map((id) => String(id ?? "").trim()).filter(Boolean));
    const kept = draft.items.filter(
        (it) => keep.has(it.produtoEmbalagemId) || !productNameMatchesHint(it.productName, nameHint)
    );
    if (kept.length === draft.items.length) return draft;
    return rebuildDraftTotals(draft, kept);
}

/** Remove linhas do draft pelos IDs de embalagem (opções rejeitadas na clarificação). */
export function removeDraftItemsByEmbalagemIds(
    draft: OrderDraft | null,
    embIds: readonly string[]
): OrderDraft | null {
    if (!draft?.items?.length || !embIds.length) return draft;
    const reject = new Set(embIds.map((id) => String(id ?? "").trim()).filter(Boolean));
    if (!reject.size) return draft;
    const kept = draft.items.filter((it) => !reject.has(it.produtoEmbalagemId));
    if (kept.length === draft.items.length) return draft;

    const totalItems = roundBrl(kept.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    const deliveryFee = draft.deliveryFee ?? 0;
    const grandTotal = roundBrl(totalItems + deliveryFee);

    if (!kept.length) {
        return {
            ...draft,
            items: [],
            totalItems: 0,
            grandTotal: deliveryFee,
            pendingConfirmation: false,
        };
    }

    return {
        ...draft,
        items: kept,
        totalItems,
        grandTotal,
        pendingConfirmation: Boolean(
            kept.length &&
                draft.paymentMethod &&
                (draft.paymentMethod !== "cash" || draft.changeFor != null) &&
                (draft.fulfillmentType === "pickup" || draft.address)
        ),
    };
}

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

    const fulfillmentType = prepared.fulfillmentType ?? current.fulfillmentType ?? null;
    const totalItems = roundBrl(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    const grandTotal = roundBrl(totalItems + (fulfillmentType === "pickup" ? 0 : (deliveryFee ?? 0)));

    const pendingConfirmation = Boolean(
        items.length &&
            paymentMethod &&
            (paymentMethod !== "cash" || changeFor != null) &&
            (fulfillmentType === "pickup" || address)
    );

    const merged: OrderDraft = {
        items,
        address: fulfillmentType === "pickup" ? (prepared.address ?? current.address) : address,
        paymentMethod,
        changeFor,
        fulfillmentType,
        deliveryFee: deliveryFee ?? 0,
        deliveryZoneId: deliveryZoneId ?? null,
        deliveryAddressText: deliveryAddressText ?? null,
        deliveryMinOrder: deliveryMinOrder ?? null,
        deliveryEtaMin: deliveryEtaMin ?? null,
        totalItems,
        grandTotal,
        pendingConfirmation,
        addressResolutionNote:
            prepared.addressResolutionNote ?? current.addressResolutionNote ?? null,
        version: 1,
    };
    return fulfillmentType === "pickup" ? applyPickupTotals(merged) : merged;
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
