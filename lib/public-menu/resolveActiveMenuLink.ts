import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPublicMenuAbsoluteUrl } from "./appBaseUrl";
import { parseMenuSlug } from "./slug";
import { signWebMenuLinkToken } from "./sessionToken";
import { normalizeBrPhone } from "./phone";

export type ActivePublicMenuLink = {
    slug: string;
    url: string;
};

/**
 * Se a empresa tem cardápio web ativo, devolve URL absoluta.
 * Com `phoneE164`, anexa token `wm` para pré-carregar cadastro/endereços no checkout.
 */
export async function resolveActivePublicMenuLink(
    admin: SupabaseClient,
    companyId: string,
    opts?: { phoneE164?: string | null }
): Promise<ActivePublicMenuLink | null> {
    const { data, error } = await admin
        .from("company_menu_profile")
        .select("slug, is_active, custom_domain, custom_domain_verified")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) {
        console.error("[public-menu] resolveActivePublicMenuLink:", error.message);
        return null;
    }
    if (!data || !data.is_active) return null;

    const slugParsed = parseMenuSlug(data.slug);
    if (!slugParsed.ok) return null;

    let wmToken: string | undefined;
    const phoneRaw = opts?.phoneE164?.trim();
    if (phoneRaw) {
        const phone = normalizeBrPhone(phoneRaw);
        if (phone.ok) {
            try {
                wmToken = signWebMenuLinkToken({
                    companyId,
                    phoneE164: phone.phoneE164,
                    slug: slugParsed.slug,
                });
            } catch (err) {
                console.warn("[public-menu] wm token skip:", err instanceof Error ? err.message : err);
            }
        }
    }

    return {
        slug: slugParsed.slug,
        url: buildPublicMenuAbsoluteUrl(slugParsed.slug, {
            utmSource: "whatsapp",
            wmToken,
            customDomain: data.custom_domain == null ? null : String(data.custom_domain),
            customDomainVerified: Boolean(data.custom_domain_verified),
        }),
    };
}

export { buildWebMenuOfferText } from "./menuOfferText";
