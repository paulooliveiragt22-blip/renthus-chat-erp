import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    PublicMenuBanner,
    PublicMenuCategory,
    PublicMenuItem,
    PublicMenuResult,
} from "@/src/types/contracts.public-menu";
import { formatMenuPackLabel } from "@/lib/products/packDisplayName";
import { parsePublicMenuRpcPayload } from "./parsePublicMenu";
import { parseMenuSlug } from "./slug";
import { loadFulfillmentPolicy } from "@/lib/delivery/fulfillment";
import { loadStoreHours, toStoreHoursPublic } from "@/lib/delivery/hours";
import {
    acceptedCustomerPaymentsFromCompanySettings,
    listEnabledCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

type PromoArtRow = {
    image_path?: string | null;
    alvos?: unknown;
};

/** Slide usa o mesmo nome e a mesma descrição do card. O nome interno da promoção fica de fora. */
function bannersFromMenu(categories: PublicMenuCategory[], promoRows: PromoArtRow[]): PublicMenuBanner[] {
    const items = categories.find((c) => c.id === "__promos__")?.items ?? [];
    const art = new Map<string, string>();
    for (const row of promoRows) {
        const url = row.image_path ? String(row.image_path) : "";
        if (!url) continue;
        const alvos = Array.isArray(row.alvos) ? row.alvos : [];
        for (const alvo of alvos) {
            if (typeof alvo !== "object" || alvo == null) continue;
            const rec = alvo as { combo_id?: unknown; produto_embalagem_id?: unknown };
            const key = String(rec.combo_id || rec.produto_embalagem_id || "");
            if (key) art.set(key, url);
        }
    }
    return items.map((item: PublicMenuItem) => {
        const key = item.comboId ?? item.embalagemId;
        const pack = formatMenuPackLabel(item.sigla, item.fatorConversao);
        return {
            id: key,
            name: item.name,
            description: item.description,
            packLabel: pack || null,
            price: item.price,
            endsAt: item.promoEndsAt ?? "",
            imageUrl: art.get(key) ?? item.imageUrl,
        };
    });
}

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
    const { data: promoRows, error: promoErr } = await admin
        .from("v_sec_promocoes")
        .select("image_path, alvos, status")
        .eq("company_id", companyId)
        .eq("status", "ativa")
        .limit(5);
    const banners = bannersFromMenu(parsed.menu.categories, promoErr ? [] : promoRows ?? []);

    return {
        ok: true,
        menu: {
            ...parsed.menu,
            banners,
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
