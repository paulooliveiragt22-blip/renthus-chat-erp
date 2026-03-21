// lib/whatsapp/types.ts — tipos compartilhados entre WhatsAppInbox e QuickReplyModal

export type Thread = {
    id: string;
    phone_e164: string;
    profile_name: string | null;
    avatar_url?: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
    created_at: string;
    bot_active: boolean | null;
    handover_at: string | null;
    unread_count?: number;
};

export type Message = {
    id: string;
    direction: "in" | "out" | "inbound" | "outbound";
    provider: string | null;
    from_addr: string | null;
    to_addr: string | null;
    body: string | null;
    status: string | null;
    created_at: string;
    num_media?: number | null;
    raw_payload?: Record<string, unknown>;
};

export type Usage = {
    allowed: boolean;
    feature_key: string;
    year_month: string;
    used: number;
    limit_per_month: number | null;
    will_overage_by: number;
    allow_overage: boolean;
};

export type OrderItem = {
    product_name: string;
    quantity: number;
    unit_price: number;
    unit_type: string;
};

export type CustomerOrder = {
    id: string;
    created_at: string;
    status: string;
    total_amount: number;
    items: OrderItem[];
};

export type CustomerProfile = {
    id: string;
    name: string | null;
    phone: string;
    totalSpent: number;
    orderCount: number;
    lastOrder: CustomerOrder | null;
    tags: string[];
};

export type DetectedMedia =
    | { kind: "image"; url: string }
    | { kind: "video"; url: string }
    | { kind: "audio"; url: string }
    | { kind: "file"; url: string; name?: string };
