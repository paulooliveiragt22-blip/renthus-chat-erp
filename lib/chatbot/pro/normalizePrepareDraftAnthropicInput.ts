import type { PrepareDraftToolInputLegacy } from "@/src/types/contracts.legacy";

/**
 * Converte o JSON da tool `prepare_order_draft` vindo do modelo (muitas vezes camelCase)
 * para o formato `PrepareDraftToolInputLegacy` esperado por `prepareOrderDraftFromTool`.
 */
export function normalizePrepareDraftAnthropicInput(raw: Record<string, unknown>): PrepareDraftToolInputLegacy {
    const rawItems = raw.items ?? raw.Items;
    let arr: unknown[] = [];
    if (Array.isArray(rawItems)) arr = rawItems;

    const items: PrepareDraftToolInputLegacy["items"] = [];
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
            produto_embalagem_id: idRaw == null ? "" : String(idRaw).trim(),
            quantity: (qtyRaw ?? 1) as number | string,
        });
    }

    const rawAddr = raw.address ?? raw.Address;
    const structured = coercePrepareAddress(rawAddr);
    const legacyCast = rawAddr as PrepareDraftToolInputLegacy["address"] | null;
    const address =
        structured ??
        (legacyCast &&
        String(legacyCast.logradouro ?? "").trim() &&
        String(legacyCast.numero ?? "").trim() &&
        String(legacyCast.bairro ?? "").trim()
            ? legacyCast
            : null);

    let addressRaw: string | null = null;
    if (raw.address_raw != null) addressRaw = String(raw.address_raw);
    else if (raw.addressRaw != null) addressRaw = String(raw.addressRaw);

    let savedId: string | null = null;
    if (raw.saved_address_id != null) savedId = String(raw.saved_address_id);
    else if (raw.savedAddressId != null) savedId = String(raw.savedAddressId);

    const changeRaw = raw.change_for ?? raw.changeFor;
    let changeFor: number | null = null;
    if (changeRaw != null) {
        const n = Number(changeRaw);
        if (Number.isFinite(n)) changeFor = n;
    }

    let paymentMethod: string | null = null;
    if (raw.payment_method != null) paymentMethod = String(raw.payment_method);
    else if (raw.paymentMethod != null) paymentMethod = String(raw.paymentMethod);

    return {
        items,
        address,
        address_raw: addressRaw,
        saved_address_id: savedId,
        use_saved_address: Boolean(raw.use_saved_address ?? raw.useSavedAddress),
        payment_method: paymentMethod,
        ready_for_confirmation: Boolean(raw.ready_for_confirmation ?? raw.readyForConfirmation),
    };
}

function coercePrepareAddress(addr: unknown): PrepareDraftToolInputLegacy["address"] | null {
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
