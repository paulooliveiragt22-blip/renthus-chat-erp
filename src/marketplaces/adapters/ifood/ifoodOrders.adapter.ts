import type {
    MarketplaceExternalOrder,
    MarketplaceOrderEvent,
    MarketplaceOrdersPort,
} from "@/src/types/contracts.marketplace-orders";
import { flattenIfoodOrderItems } from "./flattenIfoodOrderItems";

const EVENTS_BASE = "https://merchant-api.ifood.com.br/events/v1.0";
const ORDER_BASE = "https://merchant-api.ifood.com.br/order/v1.0";

function buildMockPlacedOrder(externalOrderId: string): MarketplaceExternalOrder {
    return {
        provider: "ifood",
        externalOrderId,
        displayId: externalOrderId.slice(-4).toUpperCase(),
        externalStatus: "PLACED",
        customerName: "Cliente iFood",
        customerPhone: "+5565999990001",
        deliveryAddress: "Rua Marketplace, 100 · Centro · Cuiabá - MT",
        deliveryFee: 5,
        paymentMethod: "online",
        items: [
            {
                externalItemId: "mock-item-combo-burger",
                name: "Combo X-Burger",
                quantity: 1,
                unitPrice: 28.9,
            },
            {
                externalItemId: "mock-opt-batata",
                name: "Batata frita P",
                quantity: 1,
                unitPrice: 8.0,
            },
            {
                externalItemId: "mock-item-heineken-ln",
                name: "Heineken Long Neck",
                quantity: 2,
                unitPrice: 10.9,
            },
        ],
        raw: { mock: true, id: externalOrderId, hasOptions: true },
    };
}

export class IfoodOrdersAdapter implements MarketplaceOrdersPort {
    readonly provider = "ifood" as const;

    async pollEvents(params: {
        accessToken: string;
        merchantId: string;
        useMock?: boolean;
    }): Promise<MarketplaceOrderEvent[]> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") {
            const id = `mock-ord-${Date.now()}`;
            return [
                {
                    eventId: `evt-${id}`,
                    code: "PLC",
                    orderId: id,
                    createdAt: new Date().toISOString(),
                    merchantId: params.merchantId,
                },
            ];
        }

        try {
            const url = new URL(`${EVENTS_BASE}/events:polling`);
            url.searchParams.set("excludeHeartbeat", "true");
            const res = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${params.accessToken}`,
                    accept: "application/json",
                    ...(params.merchantId
                        ? { "x-polling-merchants": params.merchantId }
                        : {}),
                },
                cache: "no-store",
                signal: AbortSignal.timeout(20_000),
            });
            if (res.status === 204) return [];
            if (!res.ok) return [];
            const json = (await res.json()) as Array<Record<string, unknown>>;
            return (json ?? []).map((e) => ({
                eventId: String(e.id ?? e.eventId ?? ""),
                code: String(e.code ?? e.fullCode ?? "") as MarketplaceOrderEvent["code"],
                orderId: String(e.orderId ?? e.order_id ?? ""),
                createdAt: String(e.createdAt ?? e.created_at ?? new Date().toISOString()),
                merchantId: e.merchantId != null ? String(e.merchantId) : null,
            })).filter((e) => e.eventId && e.orderId);
        } catch (err) {
            console.warn("[ifood/orders] poll:", err instanceof Error ? err.message : err);
            return [];
        }
    }

    async acknowledgeEvents(params: {
        accessToken: string;
        eventIds: string[];
        useMock?: boolean;
    }): Promise<void> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") return;
        if (params.eventIds.length === 0) return;
        try {
            await fetch(`${EVENTS_BASE}/events/acknowledgment`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${params.accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(params.eventIds.map((id) => ({ id }))),
                cache: "no-store",
                signal: AbortSignal.timeout(15_000),
            });
        } catch (err) {
            console.warn("[ifood/orders] ack:", err instanceof Error ? err.message : err);
        }
    }

    async fetchOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<MarketplaceExternalOrder | null> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") {
            return buildMockPlacedOrder(params.externalOrderId);
        }
        try {
            const res = await fetch(
                `${ORDER_BASE}/orders/${encodeURIComponent(params.externalOrderId)}`,
                {
                    headers: {
                        Authorization: `Bearer ${params.accessToken}`,
                        accept: "application/json",
                    },
                    cache: "no-store",
                    signal: AbortSignal.timeout(20_000),
                }
            );
            if (!res.ok) return null;
            const o = (await res.json()) as Record<string, unknown>;
            const customer = (o.customer as Record<string, unknown> | undefined) ?? {};
            const delivery = (o.delivery as Record<string, unknown> | undefined) ?? {};
            const addr = (delivery.deliveryAddress as Record<string, unknown> | undefined) ?? {};
            const itemsRaw = (o.items as Array<Record<string, unknown>> | undefined) ?? [];
            const total = (o.total as Record<string, unknown> | undefined) ?? {};
            const payments = (o.payments as Record<string, unknown> | undefined) ?? {};
            const methods = (payments.methods as Array<Record<string, unknown>> | undefined) ?? [];
            const methodName = String(methods[0]?.method ?? methods[0]?.type ?? "online").toLowerCase();

            const street = [addr.streetName, addr.streetNumber].filter(Boolean).join(", ");
            const deliveryAddress = [
                street,
                addr.neighborhood,
                addr.city && addr.state ? `${addr.city} - ${addr.state}` : addr.city,
            ]
                .filter(Boolean)
                .join(" · ");

            return {
                provider: "ifood",
                externalOrderId: String(o.id ?? params.externalOrderId),
                displayId: o.displayId != null ? String(o.displayId) : null,
                externalStatus: String(o.status ?? "PLACED"),
                customerName: customer.name != null ? String(customer.name) : null,
                customerPhone:
                    customer.phone != null
                        ? String(customer.phone)
                        : customer.phoneNumber != null
                          ? String(customer.phoneNumber)
                          : null,
                deliveryAddress: deliveryAddress || null,
                deliveryFee: Number(total.deliveryFee ?? delivery.deliveryFee ?? 0) || 0,
                paymentMethod: methodName.includes("cash")
                    ? "cash"
                    : methodName.includes("pix")
                      ? "pix"
                      : methodName.includes("credit") || methodName.includes("debit")
                        ? "card"
                        : "online",
                items: flattenIfoodOrderItems(itemsRaw),
                raw: o,
            };
        } catch (err) {
            console.warn("[ifood/orders] fetch:", err instanceof Error ? err.message : err);
            return null;
        }
    }

    async confirmOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<{ ok: boolean; error?: string }> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") {
            return { ok: true };
        }
        try {
            const res = await fetch(
                `${ORDER_BASE}/orders/${encodeURIComponent(params.externalOrderId)}/confirm`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${params.accessToken}`,
                        "Content-Type": "application/json",
                    },
                    cache: "no-store",
                    signal: AbortSignal.timeout(15_000),
                }
            );
            if (res.status === 202 || res.ok) return { ok: true };
            return { ok: false, error: `confirm_http_${res.status}` };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : "confirm_failed" };
        }
    }

    async dispatchOrder(params: {
        accessToken: string;
        externalOrderId: string;
        useMock?: boolean;
    }): Promise<{ ok: boolean; error?: string }> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") {
            return { ok: true };
        }
        try {
            const res = await fetch(
                `${ORDER_BASE}/orders/${encodeURIComponent(params.externalOrderId)}/dispatch`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${params.accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ deliveredBy: "MERCHANT" }),
                    cache: "no-store",
                    signal: AbortSignal.timeout(15_000),
                }
            );
            if (res.status === 202 || res.ok) return { ok: true };
            return { ok: false, error: `dispatch_http_${res.status}` };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : "dispatch_failed" };
        }
    }
}

export const ifoodOrdersAdapter = new IfoodOrdersAdapter();
