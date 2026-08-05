/**
 * Download de mídia WhatsApp Cloud API (bytes) para STT / processamento server-side.
 */

import { trustedMetaBinaryDownloadUrlOrNull } from "@/lib/whatsapp/graphUrlAllowlist";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

export async function downloadWhatsAppMediaBytes(params: {
    mediaId: string;
    accessToken: string;
    graphBase?: string;
}): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const mediaId = params.mediaId?.trim();
    const token = params.accessToken?.trim();
    if (!mediaId || !token) return null;

    const base = (params.graphBase ?? process.env.WHATSAPP_BASE_URL ?? GRAPH_BASE).replace(
        /\/$/,
        ""
    );

    const metaRes = await fetch(
        `${base}/${encodeURIComponent(mediaId)}?fields=url,mime_type`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const metaJson = (await metaRes.json().catch(() => ({}))) as {
        url?: string;
        mime_type?: string;
        error?: unknown;
    };
    if (!metaRes.ok || typeof metaJson.url !== "string") {
        console.warn("[wa-media] meta lookup failed", metaJson?.error ?? metaRes.status);
        return null;
    }

    const mediaDl = trustedMetaBinaryDownloadUrlOrNull(metaJson.url);
    if (!mediaDl) {
        console.warn("[wa-media] untrusted download host");
        return null;
    }

    const res = await fetch(mediaDl.href, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        console.warn("[wa-media] download failed", res.status);
        return null;
    }

    const ab = await res.arrayBuffer();
    const bytes = Buffer.from(ab);
    if (!bytes.length) return null;

    const mimeType =
        res.headers.get("content-type") ||
        (typeof metaJson.mime_type === "string" ? metaJson.mime_type : "audio/ogg");

    return { bytes, mimeType };
}
