/**
 * Mixpanel server track via HTTP API (WhatsApp / Node workers).
 * Uses NEXT_PUBLIC_MIXPANEL_TOKEN (project token is public by design).
 */

import type { OrderCreatedProps } from "./types";

const TOKEN = () =>
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim() ||
    process.env.MIXPANEL_TOKEN?.trim() ||
    "";

function encodePayload(data: unknown): string {
    return Buffer.from(JSON.stringify(data), "utf8").toString("base64");
}

/**
 * Fire-and-forget track. Never throws to callers (analytics must not break orders).
 */
export async function trackOrderCreatedServer(
    distinctId: string,
    props: OrderCreatedProps
): Promise<void> {
    const token = TOKEN();
    if (!token || !distinctId) return;

    const insertId = props.order_id
        ? `order_created:${props.order_id}`
        : `order_created:${props.channel}:${Date.now()}`;

    const body = [
        {
            event: "order_created",
            properties: {
                token,
                distinct_id: distinctId,
                time: Math.floor(Date.now() / 1000),
                $insert_id: insertId,
                channel: props.channel,
                offline: props.offline,
                fulfillment_type: props.fulfillment_type ?? undefined,
                item_count: props.item_count ?? undefined,
                company_id: props.company_id ?? undefined,
                order_id: props.order_id ?? undefined,
                platform: "server",
            },
        },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
        await fetch("https://api.mixpanel.com/track?ip=0", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(encodePayload(body))}`,
            signal: controller.signal,
        });
    } catch {
        /* best-effort */
    } finally {
        clearTimeout(timer);
    }
}
