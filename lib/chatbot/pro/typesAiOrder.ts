/**
 * Rascunho canónico de pedido IA (servidor é fonte de verdade para preços/stock).
 * Persistido em `chatbot_sessions.context.ai_order_canonical`.
 */

export interface AiOrderAddress {
    logradouro:  string;
    numero:      string;
    bairro:      string;
    complemento: string | null;
    apelido?:    string | null;
    /** Label amigável do bairro (zona) para o texto de entrega */
    bairro_label?: string | null;
}

export interface AiOrderItem {
    produto_embalagem_id: string;
    product_name:         string;
    quantity:             number;
    unit_price:           number;
    fator_conversao:      number;
    product_volume_id:    string | null;
    estoque_unidades:     number;
}

export interface AiOrderCanonicalDraft {
    items:                  AiOrderItem[];
    address:                AiOrderAddress | null;
    payment_method:         "pix" | "cash" | "card" | null;
    change_for:             number | null;
    delivery_fee:           number;
    delivery_zone_id:       string | null;
    delivery_address_text:  string | null;
    total_items:            number;
    grand_total:            number;
    pending_confirmation:   boolean;
    /** Origem do endereço quando veio de cadastro/pedido anterior */
    address_resolution_note?: string | null;
}
