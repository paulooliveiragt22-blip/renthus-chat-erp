import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicMenuResult } from "@/src/types/contracts.public-menu";
import { parsePublicMenuRpcPayload } from "./parsePublicMenu";
import { parseMenuSlug } from "./slug";
import { loadFulfillmentPolicy } from "@/lib/delivery/fulfillment";
import { loadStoreHours, toStoreHoursPublic } from "@/lib/delivery/hours";

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
    const [policy, hours] = await Promise.all([
        loadFulfillmentPolicy(admin, companyId),
        loadStoreHours(admin, companyId),
    ]);
    const publicHours = toStoreHoursPublic(hours);
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
                isOpen: publicHours.isOpen,
            },
        },
    };
}
