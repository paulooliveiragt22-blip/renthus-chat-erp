"use client";

/**
 * Mixpanel browser SDK — alinhado à doc Next.js:
 * https://docs.mixpanel.com/docs/tracking-methods/integrations/nextjs
 * + JS SDK: https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript
 *
 * Proxy same-origin `/mp` reduz bloqueio de adblock
 * (choosing-the-right-method recomenda proxy no client).
 */

import mixpanel from "mixpanel-browser";
import type { OrderCreatedProps, SignUpCompletedProps } from "./types";

function getToken(): string {
    return process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim() ?? "";
}

let initialized = false;

export function isMixpanelEnabled(): boolean {
    return getToken().length > 0;
}

export function initMixpanel(): void {
    if (initialized || typeof window === "undefined") return;
    const MIXPANEL_TOKEN = getToken();
    if (!MIXPANEL_TOKEN) {
        if (process.env.NODE_ENV === "development") {
            console.warn(
                "[mixpanel] NEXT_PUBLIC_MIXPANEL_TOKEN ausente — rebuild necessário após adicionar env."
            );
        }
        return;
    }

    // Doc Next.js: autocapture: true. ignore_dnt: true (sem UE/CA; DNT silencia o SDK).
    // api_host same-origin: rewrite /mp → api-js.mixpanel.com (adblock).
    mixpanel.init(MIXPANEL_TOKEN, {
        autocapture: true,
        track_pageview: true,
        persistence: "localStorage",
        ignore_dnt: true,
        api_host: `${window.location.origin}/mp`,
        debug: process.env.NODE_ENV === "development",
    });
    initialized = true;
}

export function mixpanelIdentify(
    userId: string,
    traits?: { email?: string | null; name?: string | null; company_id?: string | null }
): void {
    if (!getToken()) return;
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
    if (!getToken() || !initialized) return;
    mixpanel.reset();
}

export function trackSignUpCompleted(props: SignUpCompletedProps): void {
    if (!getToken()) return;
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
    if (!getToken()) return;
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

/** Evento explícito para Live View ao abrir o admin (além do autocapture). */
export function trackAppOpened(companyId?: string | null): void {
    if (!getToken()) return;
    initMixpanel();
    mixpanel.track("app_opened", {
        platform: "web",
        company_id: companyId ?? undefined,
    });
}
