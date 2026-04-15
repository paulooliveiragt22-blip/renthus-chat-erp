import type {
    DraftAddress,
    DraftItem,
    OrderDraft,
} from "./contracts";
import type {
    AiOrderAddressLegacy,
    AiOrderCanonicalDraftLegacy,
    AiOrderItemLegacy,
} from "./contracts.legacy";

export function toCanonicalAddress(legacy: AiOrderAddressLegacy): DraftAddress {
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

export function toLegacyAddress(canonical: DraftAddress): AiOrderAddressLegacy {
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

export function toCanonicalItem(legacy: AiOrderItemLegacy): DraftItem {
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

export function toLegacyItem(canonical: DraftItem): AiOrderItemLegacy {
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

export function toCanonicalDraft(legacy: AiOrderCanonicalDraftLegacy): OrderDraft {
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
        version: 1,
    };
}

export function toLegacyDraft(canonical: OrderDraft): AiOrderCanonicalDraftLegacy {
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

