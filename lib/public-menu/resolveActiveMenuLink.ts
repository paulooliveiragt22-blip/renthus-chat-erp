import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPublicMenuAbsoluteUrl } from "./appBaseUrl";
import { parseMenuSlug } from "./slug";

export type ActivePublicMenuLink = {
    slug: string;
    url: string;
};

/**
 * Se a empresa tem cardápio web ativo, devolve URL absoluta (`/c/{slug}?utm_source=whatsapp`).
 * Usado no chatbot para oferecer o link em vez do WhatsApp Flow.
 */
export async function resolveActivePublicMenuLink(
    admin: SupabaseClient,
    companyId: string
): Promise<ActivePublicMenuLink | null> {
    const { data, error } = await admin
        .from("company_menu_profile")
        .select("slug, is_active")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) {
        console.error("[public-menu] resolveActivePublicMenuLink:", error.message);
        return null;
    }
    if (!data || !data.is_active) return null;

    const slugParsed = parseMenuSlug(data.slug);
    if (!slugParsed.ok) return null;

    return {
        slug: slugParsed.slug,
        url: buildPublicMenuAbsoluteUrl(slugParsed.slug, { utmSource: "whatsapp" }),
    };
}

export { buildWebMenuOfferText } from "./menuOfferText";
