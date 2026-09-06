import "server-only";

import { metaGraphVersion, resolveMetaAppId, resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";

export type EmbeddedSignupToken = {
    accessToken: string;
    expiresIn: number | null;
};

/**
 * Troca o `code` do FB.login (Embedded Signup) por token BISU.
 * Sem redirect_uri — o code vem do JS SDK, não do dialog OAuth de Page.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<EmbeddedSignupToken> {
    const trimmed = code.trim();
    if (!trimmed) throw new Error("embedded_signup_code_required");

    const appId = resolveMetaAppId();
    const appSecret = resolveMetaAppSecret();
    if (!appId || !appSecret) throw new Error("meta_app_credentials_missing");

    const q = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code: trimmed,
    });
    const url = `https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token?${q.toString()}`;
    const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string; code?: number };
    };
    const accessToken = json.access_token?.trim() ?? "";
    if (!res.ok || !accessToken) {
        throw new Error("embedded_signup_code_exchange_failed");
    }
    return {
        accessToken,
        expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
    };
}
