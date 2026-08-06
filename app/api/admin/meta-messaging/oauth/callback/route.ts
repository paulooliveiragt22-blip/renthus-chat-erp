import { NextResponse } from "next/server";
import { resolvePublicAppBaseUrl } from "@/lib/public-menu/appBaseUrl";
import { parseMetaOAuthState } from "@/lib/meta/oauthState";
import {
    exchangeCodeForUserToken,
    exchangeForLongLivedUserToken,
    listManageablePages,
} from "@/lib/meta/exchangePageOAuth";
import { encryptCredential } from "@/lib/security/credentialCrypto";
import {
    META_OAUTH_PENDING_COOKIE,
    upsertMetaChannelFromOAuth,
} from "@/lib/meta/oauthPersist";

export const runtime = "nodejs";

function settingsRedirect(params: Record<string, string>): NextResponse {
    const base = resolvePublicAppBaseUrl();
    const url = new URL(`${base}/configuracoes`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url.toString());
}

/** Callback Facebook Login (code → Page token). */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    if (err) {
        return settingsRedirect({
            meta_oauth: "error",
            meta_oauth_msg: errDesc || err,
        });
    }

    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    const parsed = parseMetaOAuthState(state);
    if (!code || !parsed) {
        return settingsRedirect({ meta_oauth: "error", meta_oauth_msg: "invalid_oauth_state" });
    }

    const base = resolvePublicAppBaseUrl();
    const redirectUri = `${base}/api/admin/meta-messaging/oauth/callback`;

    try {
        const shortToken = await exchangeCodeForUserToken({ code, redirectUri });
        const longToken = await exchangeForLongLivedUserToken(shortToken);
        const pages = await listManageablePages(longToken);

        if (pages.length === 0) {
            return settingsRedirect({
                meta_oauth: "error",
                meta_oauth_msg: "Nenhuma Page encontrada. Confirme que você é admin da página.",
            });
        }

        if (pages.length === 1) {
            const saved = await upsertMetaChannelFromOAuth({
                companyId: parsed.companyId,
                page: pages[0]!,
            });
            if (!saved.ok) {
                return settingsRedirect({
                    meta_oauth: "error",
                    meta_oauth_msg: saved.error,
                });
            }
            return settingsRedirect({ meta_oauth: "ok" });
        }

        const pending = {
            companyId: parsed.companyId,
            pages: pages.map((p) => ({
                pageId: p.pageId,
                pageName: p.pageName,
                accessToken: p.accessToken,
                igUserId: p.igUserId,
            })),
            exp: Date.now() + 10 * 60_000,
        };
        const enc = encryptCredential(JSON.stringify(pending));
        if (!enc) {
            return settingsRedirect({
                meta_oauth: "error",
                meta_oauth_msg: "encryption_unavailable",
            });
        }

        const res = settingsRedirect({ meta_oauth: "pick" });
        res.cookies.set(META_OAUTH_PENDING_COOKIE, enc, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 600,
        });
        return res;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "oauth_failed";
        console.error("[meta/oauth/callback]", msg);
        return settingsRedirect({ meta_oauth: "error", meta_oauth_msg: msg });
    }
}
