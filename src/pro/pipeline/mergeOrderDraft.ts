import type { DraftItem, OrderDraft } from "@/src/types/contracts";
import { roundBrl } from "@/lib/chatbot/utils";

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
                draft.address &&
                draft.paymentMethod &&
                (draft.paymentMethod !== "cash" || draft.changeFor != null)
        ),
    };
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
                draft.address &&
                draft.paymentMethod &&
                (draft.paymentMethod !== "cash" || draft.changeFor != null)
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
