/**
 * Mixpanel product analytics — browser + server helpers (Quick Start).
 * Token: NEXT_PUBLIC_MIXPANEL_TOKEN (client) / same env on server.
 */

export type OrderChannel = "admin" | "pdv" | "whatsapp";

export type OrderCreatedProps = {
    channel: OrderChannel;
    offline: boolean;
    fulfillment_type?: "delivery" | "pickup" | string | null;
    item_count?: number;
    company_id?: string | null;
    order_id?: string | null;
};

export type SignUpCompletedProps = {
    sign_up_method: "email";
    platform: "web";
    plan?: string | null;
    billing_period?: string | null;
    company_id?: string | null;
};
