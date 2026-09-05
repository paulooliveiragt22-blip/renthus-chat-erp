"use client";

/**
 * Mixpanel browser SDK — init once, track / identify / reset.
 */

import mixpanel from "mixpanel-browser";
import type { OrderCreatedProps, SignUpCompletedProps } from "./types";

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim() ?? "";

let initialized = false;

export function isMixpanelEnabled(): boolean {
    return TOKEN.length > 0;
}

export function initMixpanel(): void {
    if (initialized || typeof window === "undefined" || !TOKEN) return;
    mixpanel.init(TOKEN, {
        track_pageview: false,
        persistence: "localStorage",
        ignore_dnt: false,
        debug: process.env.NODE_ENV === "development",
    });
    initialized = true;
}

export function mixpanelIdentify(
    userId: string,
    traits?: { email?: string | null; name?: string | null; company_id?: string | null }
): void {
    if (!TOKEN) return;
    initMixpanel();
    mixpanel.identify(userId);
    const people: Record<string, string> = {};
    if (traits?.email) people.$email = traits.email;
    if (traits?.name) people.$name = traits.name;
    if (traits?.company_id) people.company_id = traits.company_id;
    if (Object.keys(people).length > 0) {
        mixpanel.people.set(people);
    }
    if (traits?.company_id) {
        mixpanel.register({ company_id: traits.company_id });
    }
}

export function mixpanelReset(): void {
    if (!TOKEN || !initialized) return;
    mixpanel.reset();
}

export function trackSignUpCompleted(props: SignUpCompletedProps): void {
    if (!TOKEN) return;
    initMixpanel();
    mixpanel.track("sign_up_completed", {
        sign_up_method: props.sign_up_method,
        platform: props.platform,
        plan: props.plan ?? undefined,
        billing_period: props.billing_period ?? undefined,
        company_id: props.company_id ?? undefined,
    });
}

export function trackOrderCreated(props: OrderCreatedProps): void {
    if (!TOKEN) return;
    initMixpanel();
    mixpanel.track("order_created", {
        channel: props.channel,
        offline: props.offline,
        fulfillment_type: props.fulfillment_type ?? undefined,
        item_count: props.item_count ?? undefined,
        company_id: props.company_id ?? undefined,
        order_id: props.order_id ?? undefined,
        ...(props.order_id ? { $insert_id: `order_created:${props.order_id}` } : {}),
    });
}
