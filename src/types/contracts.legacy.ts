/**
 * Contratos legados usados pelo pipeline atual.
 * Mantido apenas para compatibilidade durante a migração.
 */

export type PaymentMethod = "pix" | "cash" | "card";

export type MessageIntent =
    | "order_intent"
    | "status_intent"
    | "human_intent"
    | "faq"
    | "greeting"
    | "unknown";

export interface AiOrderAddressLegacy {
    logradouro: string;
    numero: string;
    bairro: string;
    complemento: string | null;
    apelido?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    endereco_cliente_id?: string | null;
    bairro_label?: string | null;
}

export interface AiOrderItemLegacy {
    produto_embalagem_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    fator_conversao: number;
    product_volume_id: string | null;
    estoque_unidades: number;
}

export interface AiOrderCanonicalDraftLegacy {
    items: AiOrderItemLegacy[];
    address: AiOrderAddressLegacy | null;
    payment_method: PaymentMethod | null;
    change_for: number | null;
    delivery_fee: number;
    delivery_zone_id: string | null;
    delivery_address_text: string | null;
    delivery_min_order: number | null;
    delivery_eta_min: number | null;
    total_items: number;
    grand_total: number;
    pending_confirmation: boolean;
    address_resolution_note?: string | null;
}

export interface PrepareDraftToolInputLegacy {
    items: Array<{ produto_embalagem_id: string; quantity: number | string }>;
    address: {
        logradouro: string;
        numero: string;
        bairro: string;
        complemento?: string | null;
        apelido?: string | null;
        cidade?: string | null;
        estado?: string | null;
        cep?: string | null;
    } | null;
    address_raw?: string | null;
    saved_address_id?: string | null;
    use_saved_address?: boolean;
    payment_method?: string | null;
    change_for?: number | null;
    ready_for_confirmation?: boolean;
}

export type OrderServiceResult =
    | {
        ok: true;
        orderId: string;
        customerMessage: string;
        requireApproval: boolean;
    }
    | {
        ok: false;
        customerMessage: string;
    };

