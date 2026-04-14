import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";
import { getWhatsAppConfig } from "@/lib/whatsapp/getConfig";

// Proxy para download de mídia da WhatsApp Cloud API (Meta).
// Tenta tokens de todos os canais ativos + company_integrations + WHATSAPP_TOKEN,
// com a mesma base URL do Graph que o envio usa por canal (provider_metadata.base_url).

export const runtime = "nodejs";

function graphBase(): string {
    return (process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0").replace(/\/$/, "");
}

function graphBaseFromChannelPm(pm: Record<string, unknown> | null | undefined): string {
    const fromPm = pm && typeof pm.base_url === "string" ? pm.base_url.trim() : "";
    if (fromPm) return fromPm.replace(/\/$/, "");
    return graphBase();
}

async function proxyMediaOnce(
    mediaId: string,
    bearer: string,
    graphRoot: string
): Promise<
    | { ok: true; response: Response }
    | { ok: false; step: "meta" | "download" | "empty"; status: number; detail: unknown }
> {
    const baseUrl = graphRoot.replace(/\/$/, "");
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

    const { data: channelRows } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("company_id", companyId)
        .eq("status", "active");

    const integrationCfg = await getWhatsAppConfig(admin, companyId);
    const envToken         = process.env.WHATSAPP_TOKEN?.trim() ?? "";

    type Attempt = { bearer: string; graphRoot: string };
    const attempts: Attempt[] = [];

    for (const row of channelRows ?? []) {
        const bearer = resolveChannelAccessToken(row);
        if (!bearer) continue;
        const pm = (row.provider_metadata ?? {}) as Record<string, unknown>;
        attempts.push({ bearer, graphRoot: graphBaseFromChannelPm(pm) });
    }

    const intTok = integrationCfg.token?.trim() ?? "";
    if (intTok) {
        attempts.push({ bearer: intTok, graphRoot: graphBase() });
    }
    if (envToken) {
        attempts.push({ bearer: envToken, graphRoot: graphBase() });
    }

    const seen     = new Set<string>();
    const unique: Attempt[] = [];
    for (const a of attempts) {
        const key = `${a.graphRoot}\n${a.bearer}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(a);
    }

    if (unique.length === 0) {
        return NextResponse.json(
            {
                error: "no_channel_token",
                hint:  "Configure whatsapp_channels, company_integrations (WhatsApp) ou WHATSAPP_TOKEN na Vercel.",
            },
            { status: 500 }
        );
    }

    let lastFail: { step: string; status: number; detail: unknown } | null = null;

    for (const { bearer, graphRoot } of unique) {
        try {
            const out = await proxyMediaOnce(mediaId, bearer, graphRoot);
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
        const metaMsg =
            lastFail.detail && typeof (lastFail.detail as any).message === "string"
                ? (lastFail.detail as any).message
                : undefined;
        console.warn("[whatsapp/media] meta falhou após tentar", unique.length, "combinação(ões) token+Graph", {
            mediaId: mediaId.slice(0, 8) + "…",
            status:  lastFail.status,
            code,
            metaMsg,
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
