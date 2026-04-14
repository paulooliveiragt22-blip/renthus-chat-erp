export interface Message {
    id:          string;
    direction:   "inbound" | "outbound" | "in" | "out";
    provider:    string | null;
    from_addr:   string | null;
    to_addr:     string | null;
    body:        string | null;
    status:      string | null;
    created_at:  string;
    num_media?:   number | null;
    raw_payload?: Record<string, unknown> | null;
    sender_type?: string | null;
}

export interface Thread {
    id:                   string;
    phone_e164:           string;
    profile_name?:        string | null;
    last_message_at?:     string | null;
    last_message_preview?: string | null;
    unread_count?:        number | null;
    bot_active?:          boolean | null;
    handover_at?:         string | null;
    /** Canal WhatsApp que recebeu/enviou a thread — usado para baixar mídia com o token certo. */
    channel_id?:          string | null;
}

export interface Usage {
    used:             number;
    limit_per_month:  number | null;
    will_overage_by?: number | null;
}

export interface CustomerOrderItem {
    product_name: string;
    quantity:     number;
    unit_price:   number;
    unit_type:    string;
}

export interface CustomerOrder {
    id:           string;
    created_at:   string;
    status:       string;
    total_amount: number;
    items:        CustomerOrderItem[];
}

export interface CustomerProfile {
    id:         string;
    name:       string | null;
    phone:      string | null;
    totalSpent: number;
    orderCount: number;
    lastOrder:  CustomerOrder | null;
    tags:       string[];
}

export interface DetectedMedia {
    kind: "image" | "video" | "audio" | "file";
    url:  string;
    name?: string;
}
