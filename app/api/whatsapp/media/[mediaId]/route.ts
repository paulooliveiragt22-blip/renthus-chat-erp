import { NextResponse } from "next/server";

// Proxy para download de mídia da WhatsApp Cloud API (Meta).
// Usa WHATSAPP_TOKEN e WHATSAPP_BASE_URL / v20.0 para buscar o binário.

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    { params }: { params: { mediaId: string } }
) {
    const mediaId = params.mediaId;

    if (!mediaId) {
        return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
    }

    const token = process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0";

    if (!token) {
        return NextResponse.json({ error: "WHATSAPP_TOKEN not configured" }, { status: 500 });
    }

    try {
        const url = `${baseUrl}/${encodeURIComponent(mediaId)}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return NextResponse.json(
                {
                    error: "meta_media_fetch_failed",
                    status: res.status,
                    body: text,
                },
                { status: 502 }
            );
        }

        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
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

