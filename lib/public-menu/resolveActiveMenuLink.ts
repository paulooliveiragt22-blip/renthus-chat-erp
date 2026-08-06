import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import { buildPublicMenuAbsoluteUrl } from "./appBaseUrl";
import { parseMenuSlug } from "./slug";
import { signWebMenuChannelLinkToken, signWebMenuLinkToken } from "./sessionToken";
import { normalizeBrPhone } from "./phone";

export type ActivePublicMenuLink = {
    slug: string;
    url: string;
};

/**
 * Se a empresa tem cardápio web ativo, devolve URL absoluta.
 * Com identidade de canal (ou phone WA), anexa token `wm` (v2 preferido).
 */
export async function resolveActivePublicMenuLink(
    admin: SupabaseClient,
    companyId: string,
    opts?: {
        phoneE164?: string | null;
        identity?: { channel: MessagingChannel; externalId: string } | null;
        utmSource?: string | null;
    }
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
    let utmSource = opts?.utmSource?.trim() || "whatsapp";

    const identity = opts?.identity;
    if (identity?.channel && identity.externalId?.trim()) {
        try {
            wmToken = signWebMenuChannelLinkToken({
                companyId,
                slug: slugParsed.slug,
                channel: identity.channel,
                externalId: identity.externalId.trim(),
            });
            utmSource =
                opts?.utmSource?.trim() ||
                (identity.channel === "whatsapp" ? "whatsapp" : identity.channel);
        } catch (err) {
            console.warn("[public-menu] wm v2 token skip:", err instanceof Error ? err.message : err);
        }
    } else {
        const phoneRaw = opts?.phoneE164?.trim();
        if (phoneRaw) {
            const phone = normalizeBrPhone(phoneRaw);
            if (phone.ok) {
                try {
                    wmToken = signWebMenuChannelLinkToken({
                        companyId,
                        slug: slugParsed.slug,
                        channel: "whatsapp",
                        externalId: phone.phoneE164,
                    });
                } catch {
                    try {
                        wmToken = signWebMenuLinkToken({
                            companyId,
                            phoneE164: phone.phoneE164,
                            slug: slugParsed.slug,
                        });
                    } catch (err) {
                        console.warn(
                            "[public-menu] wm token skip:",
                            err instanceof Error ? err.message : err
                        );
                    }
                }
            }
        }
    }

    return {
        slug: slugParsed.slug,
        url: buildPublicMenuAbsoluteUrl(slugParsed.slug, {
            utmSource,
            wmToken,
            customDomain: data.custom_domain == null ? null : String(data.custom_domain),
            customDomainVerified: Boolean(data.custom_domain_verified),
        }),
    };
}

export { buildWebMenuOfferText } from "./menuOfferText";
