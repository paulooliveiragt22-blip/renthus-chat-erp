import type {
    AiOrderAddress,
    AiOrderCanonicalDraft,
    AiOrderItem,
    PrepareDraftToolInput,
} from "./contracts";
import type {
    AiOrderAddressLegacy,
    AiOrderCanonicalDraftLegacy,
    AiOrderItemLegacy,
    PrepareDraftToolInputLegacy,
} from "./contracts.legacy";

export function toCanonicalAddress(legacy: AiOrderAddressLegacy): AiOrderAddress {
    return {
        logradouro: legacy.logradouro,
        numero: legacy.numero,
        bairro: legacy.bairro,
        complemento: legacy.complemento,
        apelido: legacy.apelido ?? null,
        cidade: legacy.cidade ?? null,
        estado: legacy.estado ?? null,
        cep: legacy.cep ?? null,
        enderecoClienteId: legacy.endereco_cliente_id ?? null,
        bairroLabel: legacy.bairro_label ?? null,
    };
}

export function toLegacyAddress(canonical: AiOrderAddress): AiOrderAddressLegacy {
    return {
        logradouro: canonical.logradouro,
        numero: canonical.numero,
        bairro: canonical.bairro,
        complemento: canonical.complemento,
        apelido: canonical.apelido ?? null,
        cidade: canonical.cidade ?? null,
        estado: canonical.estado ?? null,
        cep: canonical.cep ?? null,
        endereco_cliente_id: canonical.enderecoClienteId ?? null,
        bairro_label: canonical.bairroLabel ?? null,
    };
}

export function toCanonicalItem(legacy: AiOrderItemLegacy): AiOrderItem {
    return {
        produtoEmbalagemId: legacy.produto_embalagem_id,
        productName: legacy.product_name,
        quantity: legacy.quantity,
        unitPrice: legacy.unit_price,
        fatorConversao: legacy.fator_conversao,
        productVolumeId: legacy.product_volume_id,
        estoqueUnidades: legacy.estoque_unidades,
    };
}

export function toLegacyItem(canonical: AiOrderItem): AiOrderItemLegacy {
    return {
        produto_embalagem_id: canonical.produtoEmbalagemId,
        product_name: canonical.productName,
        quantity: canonical.quantity,
        unit_price: canonical.unitPrice,
        fator_conversao: canonical.fatorConversao,
        product_volume_id: canonical.productVolumeId,
        estoque_unidades: canonical.estoqueUnidades,
    };
}

export function toCanonicalDraft(legacy: AiOrderCanonicalDraftLegacy): AiOrderCanonicalDraft {
    return {
        items: legacy.items.map(toCanonicalItem),
        address: legacy.address ? toCanonicalAddress(legacy.address) : null,
        paymentMethod: legacy.payment_method,
        changeFor: legacy.change_for,
        deliveryFee: legacy.delivery_fee,
        deliveryZoneId: legacy.delivery_zone_id,
        deliveryAddressText: legacy.delivery_address_text,
        deliveryMinOrder: legacy.delivery_min_order,
        deliveryEtaMin: legacy.delivery_eta_min,
        totalItems: legacy.total_items,
        grandTotal: legacy.grand_total,
        pendingConfirmation: legacy.pending_confirmation,
        addressResolutionNote: legacy.address_resolution_note ?? null,
    };
}

export function toLegacyDraft(canonical: AiOrderCanonicalDraft): AiOrderCanonicalDraftLegacy {
    return {
        items: canonical.items.map(toLegacyItem),
        address: canonical.address ? toLegacyAddress(canonical.address) : null,
        payment_method: canonical.paymentMethod,
        change_for: canonical.changeFor,
        delivery_fee: canonical.deliveryFee,
        delivery_zone_id: canonical.deliveryZoneId,
        delivery_address_text: canonical.deliveryAddressText,
        delivery_min_order: canonical.deliveryMinOrder,
        delivery_eta_min: canonical.deliveryEtaMin,
        total_items: canonical.totalItems,
        grand_total: canonical.grandTotal,
        pending_confirmation: canonical.pendingConfirmation,
        address_resolution_note: canonical.addressResolutionNote ?? null,
    };
}

export function toCanonicalPrepareDraftInput(
    legacy: PrepareDraftToolInputLegacy
): PrepareDraftToolInput {
    return {
        items: legacy.items.map((i) => ({
            produtoEmbalagemId: i.produto_embalagem_id,
            quantity: i.quantity,
        })),
        address: legacy.address
            ? {
                logradouro: legacy.address.logradouro,
                numero: legacy.address.numero,
                bairro: legacy.address.bairro,
                complemento: legacy.address.complemento ?? null,
                apelido: legacy.address.apelido ?? null,
                cidade: legacy.address.cidade ?? null,
                estado: legacy.address.estado ?? null,
                cep: legacy.address.cep ?? null,
            }
            : null,
        addressRaw: legacy.address_raw ?? null,
        savedAddressId: legacy.saved_address_id ?? null,
        useSavedAddress: legacy.use_saved_address ?? false,
        paymentMethod: legacy.payment_method ?? null,
        changeFor: legacy.change_for ?? null,
        readyForConfirmation: legacy.ready_for_confirmation ?? false,
    };
}

export function toLegacyPrepareDraftInput(
    canonical: PrepareDraftToolInput
): PrepareDraftToolInputLegacy {
    return {
        items: canonical.items.map((i) => ({
            produto_embalagem_id: i.produtoEmbalagemId,
            quantity: i.quantity,
        })),
        address: canonical.address
            ? {
                logradouro: canonical.address.logradouro,
                numero: canonical.address.numero,
                bairro: canonical.address.bairro,
                complemento: canonical.address.complemento ?? null,
                apelido: canonical.address.apelido ?? null,
                cidade: canonical.address.cidade ?? null,
                estado: canonical.address.estado ?? null,
                cep: canonical.address.cep ?? null,
            }
            : null,
        address_raw: canonical.addressRaw ?? null,
        saved_address_id: canonical.savedAddressId ?? null,
        use_saved_address: canonical.useSavedAddress ?? false,
        payment_method: canonical.paymentMethod ?? null,
        change_for: canonical.changeFor ?? null,
        ready_for_confirmation: canonical.readyForConfirmation ?? false,
    };
}

