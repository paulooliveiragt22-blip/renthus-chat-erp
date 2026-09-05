/**
 * Mixpanel Node SDK (server) — docs:
 * https://docs.mixpanel.com/docs/tracking-methods/sdks/nodejs
 * Prefer server-side for critical events (ad-blockers don't apply):
 * https://docs.mixpanel.com/docs/tracking-methods/choosing-the-right-method
 */

import Mixpanel from "mixpanel";
import type { OrderCreatedProps, SignUpCompletedProps } from "./types";

function token(): string {
    return (
        process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim() ||
        process.env.MIXPANEL_TOKEN?.trim() ||
        ""
    );
}

let client: Mixpanel.Mixpanel | null = null;

function getClient(): Mixpanel.Mixpanel | null {
    const t = token();
    if (!t) return null;
    if (!client) {
        client = Mixpanel.init(t, {
            // Server IP must not become every user's geo
            geolocate: false,
        });
    }
    return client;
}

function trackAsync(
    event: string,
    properties: Record<string, unknown>
): Promise<void> {
    const mp = getClient();
    if (!mp) return Promise.resolve();
    return new Promise((resolve) => {
        try {
            mp.track(event, properties, () => resolve());
        } catch {
            resolve();
        }
        // Safety: never hang serverless
        setTimeout(resolve, 3_000);
    });
}

export async function trackOrderCreatedServer(
    distinctId: string,
    props: OrderCreatedProps
): Promise<void> {
    if (!distinctId) return;
    const insertId = props.order_id
        ? `order_created:${props.order_id}`
        : undefined;
    await trackAsync("order_created", {
        distinct_id: distinctId,
        ip: "0",
        channel: props.channel,
        offline: props.offline,
        fulfillment_type: props.fulfillment_type ?? undefined,
        item_count: props.item_count ?? undefined,
        company_id: props.company_id ?? undefined,
        order_id: props.order_id ?? undefined,
        platform: "server",
        ...(insertId ? { $insert_id: insertId } : {}),
    });
}

export async function trackSignUpCompletedServer(
    distinctId: string,
    props: SignUpCompletedProps
): Promise<void> {
    if (!distinctId) return;
    await trackAsync("sign_up_completed", {
        distinct_id: distinctId,
        ip: "0",
        sign_up_method: props.sign_up_method,
        platform: props.platform,
        plan: props.plan ?? undefined,
        billing_period: props.billing_period ?? undefined,
        company_id: props.company_id ?? undefined,
    });
}

export async function trackAppOpenedServer(
    distinctId: string,
    companyId?: string | null
): Promise<void> {
    if (!distinctId) return;
    await trackAsync("app_opened", {
        distinct_id: distinctId,
        ip: "0",
        platform: "web",
        company_id: companyId ?? undefined,
    });
}
