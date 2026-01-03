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
    product_variant_id: string | null;
    product_name: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
    created_at: string;
};

export type OrderFull = OrderRow & { items: OrderItemRow[] };

export type UnitType = "none" | "l" | "ml" | "kg" | "g" | "un" | string;

export type Variant = {
    id: string;

    unit_price: number;
    has_case?: boolean | null;
    case_qty?: number | null;
    case_price?: number | null;

    unit?: UnitType | null;
    volume_value?: number | null;

    details?: string | null;
    is_active?: boolean | null;

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
