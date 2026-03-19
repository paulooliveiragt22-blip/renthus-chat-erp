export type PaymentMethod = "pix" | "card" | "cash";
export type OrderStatus = "new" | "canceled" | "delivered" | "finalized";

export type CustomerRow = { name: string | null; phone: string | null; address: string | null };

export type OrderRow = {
    id: string;
    status: OrderStatus | string;
    channel: string;
    total_amount: number;
    delivery_fee: number;
    payment_method: PaymentMethod;
    paid: boolean;
    change_for: number | null;
    created_at: string;
    details: string | null;
    customers: CustomerRow | null;
};

export type OrderItemRow = {
    id: string;
    order_id: string;
    // Novo modelo (embalagem)
    produto_embalagem_id?: string | null;

    // Legado (não existe mais no DB, mas deixamos opcional para compilar trechos antigos)
    product_variant_id?: string | null;
    product_name: string | null;

    // quantidade inteira (legacy) / qty (numérico)
    quantity: number | null;

    // qty numérico (adicionado para compatibilidade)
    qty?: number | null;

    // tipo de unidade: "unit" | "case" | null
    // no novo modelo, pode ser "UN" | "CX" etc (sigla_comercial)
    unit_type?: string | null;

    // preço unitário salvo no item
    unit_price: number | null;

    // total da linha
    line_total: number | null;

    created_at: string;
};

export type OrderFull = OrderRow & { items: OrderItemRow[] };

export type UnitType = "none" | "l" | "ml" | "kg" | "g" | "un" | string;

// A UI ainda trabalha com "variant" e "mode" (unit/case).
// No novo modelo, essa "variant" será um agregado (UN + CX) feito na camada de frontend,
// apontando para IDs reais de embalagem (unit_embalagem_id / case_embalagem_id).
export type Variant = {
    id: string;
    unit_price: number;
    has_case?: boolean | null;
    case_qty?: number | null;
    case_price?: number | null;

    unit?: UnitType | null;
    volume_value?: number | null;

    details?: string | null;
    tags?: string | null;
    is_active?: boolean | null;

    // Códigos para busca unificada no PDV
    codigo_interno?: string | null;
    codigo_barras_ean?: string | null;

    // IDs reais no novo modelo (produto_embalagens)
    unit_embalagem_id?: string | null;
    case_embalagem_id?: string | null;

    products?: {
        name?: string | null;
        categories?: { name?: string | null } | null;
        brands?: { name?: string | null } | null;
    } | null;
};

export type DraftQty = { unit: string; box: string };

export type CartItem = {
    variant: Variant;
    qty: number;
    price: number;
    mode: "unit" | "case";
};
