import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

// Proxy para download de mídia da WhatsApp Cloud API (Meta).
// Usa o canal WhatsApp ativo da empresa da sessão; se a Meta recusar, tenta
// WHATSAPP_TOKEN (legado / mesmo WABA) uma vez — evita 502 quando o canal no DB
// está vazio ou o token cifrado não decifra em produção.

export const runtime = "nodejs";

function graphBase(): string {
    return (process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0").replace(/\/$/, "");
}

async function proxyMediaOnce(
    mediaId: string,
    bearer: string
): Promise<
    | { ok: true; response: Response }
    | { ok: false; step: "meta" | "download" | "empty"; status: number; detail: unknown }
> {
    const baseUrl = graphBase();
    const metaRes   = await fetch(
        `${baseUrl}/${encodeURIComponent(mediaId)}?fields=url,mime_type`,
        { headers: { Authorization: `Bearer ${bearer}` } }
    );

    const metaJson = (await metaRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!metaRes.ok || typeof metaJson.url !== "string" || !metaJson.url) {
        return {
            ok:     false,
            step:   "meta",
            status: metaRes.status,
            detail: metaJson?.error ?? metaJson,
        };
    }

    const mediaUrl = metaJson.url as string;
    const res        = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${bearer}` },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, step: "download", status: res.status, detail: text.slice(0, 500) };
    }

    const contentType =
        res.headers.get("content-type") ??
        (typeof metaJson.mime_type === "string" ? metaJson.mime_type : null) ??
        "application/octet-stream";
    const contentLength = res.headers.get("content-length") ?? undefined;
    const body          = res.body;
    if (!body) {
        return { ok: false, step: "empty", status: 502, detail: "empty_media_body" };
    }

    return {
        ok: true,
        response: new Response(body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                ...(contentLength ? { "Content-Length": contentLength } : {}),
            },
        }),
    };
}

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

    const channelToken = channel ? resolveChannelAccessToken(channel) : "";
    const envToken     = process.env.WHATSAPP_TOKEN?.trim() ?? "";

    const candidates = [...new Set([channelToken, envToken].filter((t) => t.length > 0))];

    if (candidates.length === 0) {
        return NextResponse.json(
            {
                error: "no_channel_token",
                hint:  "Configure o canal WhatsApp da empresa ou WHATSAPP_TOKEN na Vercel.",
            },
            { status: 500 }
        );
    }

    let lastFail: { step: string; status: number; detail: unknown } | null = null;

    for (const bearer of candidates) {
        try {
            const out = await proxyMediaOnce(mediaId, bearer);
            if (out.ok) return out.response;
            lastFail = { step: out.step, status: out.status, detail: out.detail };
            if (process.env.NODE_ENV !== "production") {
                console.warn("[whatsapp/media] tentativa falhou:", out.step, out.status);
            }
        } catch (e: any) {
            lastFail = { step: "exception", status: 500, detail: String(e?.message ?? e) };
        }
    }

    const code =
        lastFail?.step === "meta" && typeof (lastFail.detail as any)?.code === "number"
            ? (lastFail.detail as any).code
            : undefined;
    if (lastFail?.step === "meta") {
        console.warn("[whatsapp/media] meta falhou após tentar", candidates.length, "token(s)", {
            mediaId: mediaId.slice(0, 8) + "…",
            status:  lastFail.status,
            code,
        });
    }

    return NextResponse.json(
        {
            error: "meta_media_failed",
            step:  lastFail?.step ?? "unknown",
            ...(lastFail?.step === "meta"
                ? { status: lastFail.status, body: lastFail.detail }
                : {}),
            ...(lastFail?.step === "download"
                ? { status: lastFail.status, body: lastFail.detail }
                : {}),
        },
        { status: 502 }
    );
}
