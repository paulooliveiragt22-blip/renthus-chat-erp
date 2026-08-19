import type { PrepareDraftToolInput } from "@/src/types/contracts";

/**
 * Converte o JSON da tool `prepare_order_draft` vindo do modelo (snake_case ou camelCase)
 * para `PrepareDraftToolInput` (camelCase) consumido por `prepareOrderDraftFromTool`.
 */
export function normalizePrepareDraftAnthropicInput(raw: Record<string, unknown>): PrepareDraftToolInput {
    const rawItems = raw.items ?? raw.Items;
    let arr: unknown[] = [];
    if (Array.isArray(rawItems)) arr = rawItems;

    const items: PrepareDraftToolInput["items"] = [];
    for (const row of arr) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const idRaw =
            r.produto_embalagem_id ??
            r.produtoEmbalagemId ??
            r.id ??
            r.pack_id ??
            r.embalagem_id;
        const qtyRaw = r.quantity ?? r.qty ?? r.quantidade;
        items.push({
            produtoEmbalagemId: idRaw == null ? "" : String(idRaw).trim(),
            quantity: (qtyRaw ?? 1) as number | string,
        });
    }

    const rawAddr = raw.address ?? raw.Address;
    const structured = coercePrepareAddress(rawAddr);
    const cast = rawAddr as PrepareDraftToolInput["address"] | null;
    const address =
        structured ??
        (cast &&
        String(cast.logradouro ?? "").trim() &&
        String(cast.numero ?? "").trim() &&
        String(cast.bairro ?? "").trim()
            ? cast
            : null);

    let addressRaw: string | null = null;
    if (raw.address_raw != null) addressRaw = String(raw.address_raw);
    else if (raw.addressRaw != null) addressRaw = String(raw.addressRaw);

    let savedAddressId: string | null = null;
    if (raw.saved_address_id != null) savedAddressId = String(raw.saved_address_id);
    else if (raw.savedAddressId != null) savedAddressId = String(raw.savedAddressId);

    const changeRaw = raw.change_for ?? raw.changeFor;
    let changeFor: number | null = null;
    if (changeRaw != null) {
        const n = Number(changeRaw);
        if (Number.isFinite(n)) changeFor = n;
    }

    let paymentMethod: string | null = null;
    if (raw.payment_method != null) paymentMethod = String(raw.payment_method);
    else if (raw.paymentMethod != null) paymentMethod = String(raw.paymentMethod);

    let orderNotes: string | null | undefined;
    if ("order_notes" in raw || "orderNotes" in raw) {
        const n = raw.order_notes ?? raw.orderNotes;
        orderNotes = n == null ? null : String(n);
    }

    return {
        items,
        address,
        addressRaw,
        savedAddressId,
        useSavedAddress: Boolean(raw.use_saved_address ?? raw.useSavedAddress),
        paymentMethod,
        changeFor,
        readyForConfirmation: Boolean(raw.ready_for_confirmation ?? raw.readyForConfirmation),
        orderNotes,
    };
}

function coercePrepareAddress(addr: unknown): PrepareDraftToolInput["address"] | null {
    if (!addr || typeof addr !== "object") return null;
    const o = addr as Record<string, unknown>;
    const logradouro = String(o.logradouro ?? o.street ?? o.rua ?? "").trim();
    const numero = String(o.numero ?? o.number ?? o.num ?? "").trim();
    const bairro = String(o.bairro ?? o.neighborhood ?? "").trim();
    if (!logradouro && !numero && !bairro) return null;
    return {
        logradouro,
        numero,
        bairro,
        complemento: o.complemento == null ? null : String(o.complemento),
        apelido: o.apelido == null ? null : String(o.apelido),
        cidade: o.cidade == null ? null : String(o.cidade),
        estado: o.estado == null ? null : String(o.estado),
        cep: o.cep == null ? null : String(o.cep),
    };
}
