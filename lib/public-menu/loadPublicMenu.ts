import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicMenuResult } from "@/src/types/contracts.public-menu";
import { parsePublicMenuRpcPayload } from "./parsePublicMenu";
import { parseMenuSlug } from "./slug";
import { loadFulfillmentPolicy } from "@/lib/delivery/fulfillment";
import { loadStoreHours, toStoreHoursPublic } from "@/lib/delivery/hours";
import {
    acceptedCustomerPaymentsFromCompanySettings,
    listEnabledCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

function parseDeliveryMinOrder(settings: unknown): number | null {
    if (typeof settings !== "object" || settings == null || Array.isArray(settings)) return null;
    const raw = (settings as Record<string, unknown>).delivery_min_order;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export async function loadPublicMenuBySlug(
    admin: SupabaseClient,
    slugRaw: string
): Promise<PublicMenuResult> {
    const slugParsed = parseMenuSlug(slugRaw);
    if (!slugParsed.ok) {
        return { ok: false, error: "menu_not_found" };
    }

    const { data, error } = await admin.rpc("rpc_get_public_menu", {
        p_slug: slugParsed.slug,
    });

    if (error) {
        console.error("[public-menu] rpc_get_public_menu:", error.message);
        return { ok: false, error: "menu_not_found" };
    }

    const parsed = parsePublicMenuRpcPayload(data);
    if (!parsed.ok) return parsed;

    const companyId = parsed.menu.store.companyId;
    const [policy, hours, companyRow] = await Promise.all([
        loadFulfillmentPolicy(admin, companyId),
        loadStoreHours(admin, companyId),
        admin.from("companies").select("settings").eq("id", companyId).maybeSingle(),
    ]);
    const publicHours = toStoreHoursPublic(hours);
    const settings = companyRow.data?.settings;
    const deliveryMinOrder = parseDeliveryMinOrder(settings);
    const acceptedPayments = listEnabledCustomerPayments(
        acceptedCustomerPaymentsFromCompanySettings(settings)
    );
    return {
        ok: true,
        menu: {
            ...parsed.menu,
            store: {
                ...parsed.menu.store,
                deliveriesEnabled: policy.deliveriesEnabled,
                pickupEnabled: policy.pickupEnabled,
                openTime: publicHours.openTime,
                closeTime: publicHours.closeTime,
                timeZone: publicHours.timeZone,
                deliveryDescription: publicHours.deliveryDescription,
                deliveryMinOrder,
                acceptedPayments,
                isOpen: publicHours.isOpen,
                periods: publicHours.periods,
                hoursLabel: publicHours.hoursLabel,
                closedMessage: publicHours.closedMessage,
            },
        },
    };
}
