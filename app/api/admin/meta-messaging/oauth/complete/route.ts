import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    toPublicMetaConnection,
    type MetaMessagingChannelRow,
} from "@/lib/meta/messagingChannels";
import type { MetaOAuthPageOption } from "@/lib/meta/exchangePageOAuth";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import {
    META_OAUTH_PENDING_COOKIE,
    upsertMetaChannelFromOAuth,
} from "@/lib/meta/oauthPersist";

export const runtime = "nodejs";

/** Escolhe Page após OAuth com várias páginas. */
export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as { pageId?: string };
    const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
    if (!pageId) return NextResponse.json({ error: "page_id_required" }, { status: 400 });

    const jar = await cookies();
    const raw = jar.get(META_OAUTH_PENDING_COOKIE)?.value;
    if (!raw) {
        return NextResponse.json({ error: "oauth_pending_expired" }, { status: 400 });
    }

    const dec = decryptCredential(raw);
    if (!dec) return NextResponse.json({ error: "oauth_pending_invalid" }, { status: 400 });

    let pending: { companyId: string; pages: MetaOAuthPageOption[]; exp: number };
    try {
        pending = JSON.parse(dec) as typeof pending;
    } catch {
        return NextResponse.json({ error: "oauth_pending_invalid" }, { status: 400 });
    }

    if (pending.companyId !== companyId || Date.now() > pending.exp) {
        return NextResponse.json({ error: "oauth_pending_expired" }, { status: 400 });
    }

    const page = pending.pages.find((p) => p.pageId === pageId);
    if (!page) return NextResponse.json({ error: "page_not_in_pending" }, { status: 400 });

    const saved = await upsertMetaChannelFromOAuth({ companyId, page });
    if (!saved.ok) {
        return NextResponse.json({ error: saved.error }, { status: 500 });
    }

    const { data } = await admin
        .from("meta_messaging_channels")
        .select(
            "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
        )
        .eq("company_id", companyId)
        .maybeSingle();

    const res = NextResponse.json({
        connection: data
            ? toPublicMetaConnection(data as MetaMessagingChannelRow)
            : null,
    });
    res.cookies.set(META_OAUTH_PENDING_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
}
