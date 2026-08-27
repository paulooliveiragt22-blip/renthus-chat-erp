import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    META_MESSAGING_OAUTH_SCOPES,
    metaGraphVersion,
    resolveMetaAppId,
    resolveMetaAppSecret,
} from "@/lib/meta/metaAppCredentials";
import { createMetaOAuthState } from "@/lib/meta/oauthState";
import { resolveOAuthRedirectBase } from "@/lib/meta/resolveOAuthRedirectBase";

export const runtime = "nodejs";

/**
 * Inicia Facebook Login → Page token (Messenger + Instagram Messaging).
 * Retorna URL para redirect no browser.
 */
export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
    if (!feat.ok) return feat.response;

    const appId = resolveMetaAppId();
    const appSecret = resolveMetaAppSecret();
    if (!appId || !appSecret) {
        return NextResponse.json(
            {
                error: "meta_app_not_configured",
                hint: "Defina META_APP_ID e META_APP_SECRET (ou WHATSAPP_APP_SECRET) no ambiente.",
            },
            { status: 503 }
        );
    }

    const base = resolveOAuthRedirectBase(req);
    const redirectUri = `${base}/api/admin/meta-messaging/oauth/callback`;
    const state = createMetaOAuthState(companyId);

    const url = new URL(`https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_MESSAGING_OAUTH_SCOPES);

    return NextResponse.json({
        url: url.toString(),
        redirectUri,
        appId,
        scopes: META_MESSAGING_OAUTH_SCOPES.split(","),
    });
}
