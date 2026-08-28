import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
    subscribeInstagramMessagingWebhooks,
    subscribePageMessagingWebhooks,
    type MetaOAuthPageOption,
} from "@/lib/meta/exchangePageOAuth";
import { encryptPageAccessToken } from "@/lib/meta/messagingChannels";

export const META_OAUTH_PENDING_COOKIE = "meta_oauth_pages";

export async function upsertMetaChannelFromOAuth(params: {
    companyId: string;
    page: MetaOAuthPageOption;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const admin = createAdminClient();
    const encrypted = encryptPageAccessToken(params.page.accessToken);
    if (!encrypted) {
        return { ok: false, error: "encryption_unavailable" };
    }

    const { data: existing } = await admin
        .from("meta_messaging_channels")
        .select("id")
        .eq("company_id", params.companyId)
        .maybeSingle();

    const payload = {
        company_id: params.companyId,
        page_id: params.page.pageId,
        page_name: params.page.pageName,
        ig_user_id: params.page.igUserId,
        encrypted_page_access_token: encrypted,
        status: "active",
        messenger_enabled: true,
        instagram_enabled: Boolean(params.page.igUserId),
        updated_at: new Date().toISOString(),
        provider_metadata: {
            connected_via: "oauth",
            connected_at: new Date().toISOString(),
        },
    };

    const { error } = existing?.id
        ? await admin.from("meta_messaging_channels").update(payload).eq("id", existing.id)
        : await admin.from("meta_messaging_channels").insert(payload);

    if (error) return { ok: false, error: error.message };

    const sub = await subscribePageMessagingWebhooks({
        pageId: params.page.pageId,
        pageAccessToken: params.page.accessToken,
    });
    if (!sub.ok) {
        console.warn("[meta/oauth] subscribed_apps failed:", sub.error);
    }
    if (params.page.igUserId) {
        const igSub = await subscribeInstagramMessagingWebhooks({
            igUserId: params.page.igUserId,
            pageAccessToken: params.page.accessToken,
        });
        if (!igSub.ok) {
            console.warn("[meta/oauth] ig subscribed_apps failed:", igSub.error);
        }
    }
    return { ok: true };
}
