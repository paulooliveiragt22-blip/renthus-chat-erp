import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

// Proxy para download de mídia da WhatsApp Cloud API (Meta).
// Usa o canal WhatsApp ativo da empresa da sessão (cookie de workspace).

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    { params }: { params: { mediaId: string } }
) {
    const ctx = await requireCompanyAccess();
    if (!ctx.ok) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { admin, companyId } = ctx;
    const mediaId              = params.mediaId;

    if (!mediaId) {
        return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
    }

    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("company_id", companyId)
        .eq("status", "active")
        .maybeSingle();

    const token = channel ? resolveChannelAccessToken(channel) : "";
    if (!token) {
        return NextResponse.json(
            { error: "no_channel_token", hint: "Configure o canal WhatsApp da empresa no superadmin." },
            { status: 500 }
        );
    }

    const baseUrl = process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0";

    try {
        const metaRes = await fetch(
            `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(mediaId)}?fields=url,mime_type`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        const metaJson = await metaRes.json().catch(() => ({}));
        if (!metaRes.ok || !metaJson?.url) {
            return NextResponse.json(
                {
                    error:  "meta_media_meta_failed",
                    status: metaRes.status,
                    body:   metaJson,
                },
                { status: 502 }
            );
        }

        const mediaUrl: string = metaJson.url;

        const res = await fetch(mediaUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return NextResponse.json(
                {
                    error:  "meta_media_fetch_failed",
                    status: res.status,
                    body:   text,
                },
                { status: 502 }
            );
        }

        const contentType =
            res.headers.get("content-type") ??
            metaJson.mime_type ??
            "application/octet-stream";
        const contentLength = res.headers.get("content-length") ?? undefined;

        const body = res.body;
        if (!body) {
            return NextResponse.json({ error: "empty_media_body" }, { status: 502 });
        }

        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                ...(contentLength ? { "Content-Length": contentLength } : {}),
            },
        });
    } catch (e: any) {
        return NextResponse.json(
            { error: "media_proxy_error", details: String(e?.message ?? e) },
            { status: 500 }
        );
    }
}
