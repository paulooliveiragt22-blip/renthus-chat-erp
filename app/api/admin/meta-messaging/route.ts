import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    encryptPageAccessToken,
    toPublicMetaConnection,
    type MetaMessagingChannelRow,
} from "@/lib/meta/messagingChannels";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import { META_OAUTH_PENDING_COOKIE } from "@/lib/meta/oauthPersist";
import { resolveMetaAppId } from "@/lib/meta/metaAppCredentials";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("orders.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("meta_messaging_channels")
        .select(
            "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
        )
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let pendingPages: Array<{ pageId: string; pageName: string; igUserId: string | null }> = [];
    try {
        const jar = await cookies();
        const raw = jar.get(META_OAUTH_PENDING_COOKIE)?.value;
        if (raw) {
            const dec = decryptCredential(raw);
            if (dec) {
                const pending = JSON.parse(dec) as {
                    companyId?: string;
                    exp?: number;
                    pages?: Array<{
                        pageId: string;
                        pageName: string;
                        igUserId: string | null;
                    }>;
                };
                if (
                    pending.companyId === companyId &&
                    typeof pending.exp === "number" &&
                    Date.now() <= pending.exp &&
                    Array.isArray(pending.pages)
                ) {
                    pendingPages = pending.pages.map((p) => ({
                        pageId: p.pageId,
                        pageName: p.pageName,
                        igUserId: p.igUserId ?? null,
                    }));
                }
            }
        }
    } catch {
        pendingPages = [];
    }

    return NextResponse.json({
        connection: data
            ? toPublicMetaConnection(data as MetaMessagingChannelRow)
            : null,
        webhookPath: "/api/meta/messaging/incoming",
        oauthConfigured: Boolean(resolveMetaAppId()),
        pendingPages,
    });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        pageId?: string;
        pageName?: string | null;
        igUserId?: string | null;
        pageAccessToken?: string | null;
        status?: "active" | "inactive";
        messengerEnabled?: boolean;
        instagramEnabled?: boolean;
    };

    const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
    if (!pageId) {
        return NextResponse.json({ error: "page_id_required" }, { status: 400 });
    }

    let encrypted: string | null | undefined;
    if (typeof body.pageAccessToken === "string" && body.pageAccessToken.trim()) {
        encrypted = encryptPageAccessToken(body.pageAccessToken.trim());
        if (!encrypted) {
            return NextResponse.json(
                {
                    error: "encryption_unavailable",
                    hint: "Defina CREDENTIALS_ENCRYPTION_KEY (32 bytes base64).",
                },
                { status: 500 }
            );
        }
    } else if (body.pageAccessToken === null) {
        encrypted = null;
    }

    const { data: existing } = await admin
        .from("meta_messaging_channels")
        .select("id, encrypted_page_access_token")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!existing?.encrypted_page_access_token && encrypted === undefined) {
        return NextResponse.json(
            {
                error: "token_required",
                hint: "Informe o Page Access Token da Meta (com permissões de mensagens).",
            },
            { status: 400 }
        );
    }

    const payload: Record<string, unknown> = {
        company_id: companyId,
        page_id: pageId,
        page_name: typeof body.pageName === "string" ? body.pageName.trim() || null : null,
        ig_user_id:
            typeof body.igUserId === "string" ? body.igUserId.trim() || null : null,
        status: body.status === "inactive" ? "inactive" : "active",
        messenger_enabled: body.messengerEnabled !== false,
        instagram_enabled: body.instagramEnabled !== false,
        updated_at: new Date().toISOString(),
    };
    if (encrypted !== undefined) {
        payload.encrypted_page_access_token = encrypted;
    }

    const { data, error } = existing?.id
        ? await admin
              .from("meta_messaging_channels")
              .update(payload)
              .eq("id", existing.id)
              .select(
                  "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
              )
              .single()
        : await admin
              .from("meta_messaging_channels")
              .insert(payload)
              .select(
                  "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
              )
              .single();

    if (error || !data) {
        return NextResponse.json({ error: error?.message ?? "save_failed" }, { status: 500 });
    }

    return NextResponse.json({
        connection: toPublicMetaConnection(data as MetaMessagingChannelRow),
        webhookPath: "/api/meta/messaging/incoming",
    });
}
