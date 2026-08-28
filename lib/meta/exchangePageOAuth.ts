import "server-only";

import {
    metaGraphVersion,
    resolveMetaAppId,
    resolveMetaAppSecret,
} from "@/lib/meta/metaAppCredentials";

export type MetaOAuthPageOption = {
    pageId: string;
    pageName: string;
    accessToken: string;
    igUserId: string | null;
};

async function graphGet<T>(pathAndQuery: string): Promise<T> {
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${pathAndQuery.replace(/^\//, "")}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as T & {
        error?: { message?: string };
    };
    if (!res.ok) {
        throw new Error(json?.error?.message || `graph_${res.status}`);
    }
    return json;
}

/** Troca code → user token de curta duração. */
export async function exchangeCodeForUserToken(params: {
    code: string;
    redirectUri: string;
}): Promise<string> {
    const appId = resolveMetaAppId();
    const appSecret = resolveMetaAppSecret();
    if (!appId || !appSecret) throw new Error("meta_app_credentials_missing");

    const q = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: params.redirectUri,
        code: params.code,
    });
    const json = await graphGet<{ access_token?: string }>(`oauth/access_token?${q}`);
    const token = json.access_token?.trim();
    if (!token) throw new Error("user_token_missing");
    return token;
}

/** User token curto → longo (~60d). */
export async function exchangeForLongLivedUserToken(shortLived: string): Promise<string> {
    const appId = resolveMetaAppId();
    const appSecret = resolveMetaAppSecret();
    if (!appId || !appSecret) throw new Error("meta_app_credentials_missing");

    const q = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived,
    });
    const json = await graphGet<{ access_token?: string }>(`oauth/access_token?${q}`);
    return json.access_token?.trim() || shortLived;
}

export async function listManageablePages(userAccessToken: string): Promise<MetaOAuthPageOption[]> {
    const q = new URLSearchParams({
        fields: "id,name,access_token,instagram_business_account{id}",
        access_token: userAccessToken,
        limit: "100",
    });
    const json = await graphGet<{
        data?: Array<{
            id?: string;
            name?: string;
            access_token?: string;
            instagram_business_account?: { id?: string } | null;
        }>;
    }>(`me/accounts?${q}`);

    return (json.data ?? [])
        .map((p) => {
            const pageId = String(p.id ?? "").trim();
            const accessToken = String(p.access_token ?? "").trim();
            if (!pageId || !accessToken) return null;
            return {
                pageId,
                pageName: String(p.name ?? "").trim() || pageId,
                accessToken,
                igUserId: p.instagram_business_account?.id?.trim() || null,
            } satisfies MetaOAuthPageOption;
        })
        .filter((p): p is MetaOAuthPageOption => Boolean(p));
}

/** Inscreve o app nos webhooks da Page (mensagens Messenger/IG). */
export async function subscribePageMessagingWebhooks(params: {
    pageId: string;
    pageAccessToken: string;
}): Promise<{ ok: boolean; error?: string }> {
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(params.pageId)}/subscribed_apps`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            subscribed_fields: ["messages", "messaging_postbacks", "message_deliveries", "message_reads"],
            access_token: params.pageAccessToken,
        }),
    });
    const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { message?: string };
    };
    if (!res.ok || json.success === false) {
        return { ok: false, error: json.error?.message || `subscribe_${res.status}` };
    }
    return { ok: true };
}

/** Inscreve o app nos webhooks da conta IG profissional (complementa subscribed_apps da Page). */
export async function subscribeInstagramMessagingWebhooks(params: {
    igUserId: string;
    pageAccessToken: string;
}): Promise<{ ok: boolean; error?: string }> {
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(params.igUserId)}/subscribed_apps`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            subscribed_fields: ["messages", "messaging_postbacks", "message_deliveries", "message_reads"],
            access_token: params.pageAccessToken,
        }),
    });
    const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { message?: string };
    };
    if (!res.ok || json.success === false) {
        return { ok: false, error: json.error?.message || `ig_subscribe_${res.status}` };
    }
    return { ok: true };
}
