import type { MarketplaceProvider } from "./contracts.marketplace";

export type MarketplaceOrderEventCode =
    | "PLC" // PLACED
    | "CFM" // CONFIRMED
    | "RTP" // READY_TO_PICKUP
    | "DSP" // DISPATCHED
    | "CON" // CONCLUDED
    | "CAN" // CANCELLED
    | string;

export interface MarketplaceOrderEvent {
    eventId: string;
    code: MarketplaceOrderEventCode;
    orderId: string;
    createdAt: string;
    merchantId?: string | null;
}

export interface MarketplaceExternalOrderItem {
    externalItemId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
}

export interface MarketplaceExternalOrder {
    provider: MarketplaceProvider;
    externalOrderId: string;
    displayId: string | null;
    externalStatus: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
    deliveryFee: number;
    paymentMethod: "pix" | "cash" | "card" | "online" | string;
    items: MarketplaceExternalOrderItem[];
    raw: Record<string, unknown>;
}

export interface MarketplaceOrdersPort {
    readonly provider: MarketplaceProvider;
    pollEvents(params: {
        accessToken: string;
        merchantId: string;
        useMock?: boolean;
    }): Promise<MarketplaceOrderEvent[]>;
    acknowledgeEvents(params: {
        accessToken: string;
        eventIds: string[];
        useMock?: boolean;
    }): Promise<void>;
    fetchOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<MarketplaceExternalOrder | null>;
    confirmOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<{ ok: boolean; error?: string }>;
    dispatchOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<{ ok: boolean; error?: string }>;
}

export interface MarketplacePollResult {
    ok: boolean;
    provider: MarketplaceProvider;
    events: number;
    imported: number;
    skipped: number;
    errors: number;
    message: string | null;
}
