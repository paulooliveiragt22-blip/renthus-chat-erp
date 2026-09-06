import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { enforcePublicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import type { PublicMenuEventType } from "@/src/types/contracts.public-menu";

export const runtime = "nodejs";

const RL_LIMIT = 120;
const EVENT_TYPES = new Set<PublicMenuEventType>(["page_view", "product_view", "category_view"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asOptionalUuid(v: unknown): string | null {
    if (typeof v !== "string" || !v.trim()) return null;
    return UUID_RE.test(v.trim()) ? v.trim() : null;
}

/**
 * POST /api/public/menu/[slug]/events
 * Analytics leve (visitor_id anônimo). Sem PII. Rate limit IP+slug (B12).
 */
export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const { slug: slugParam } = await ctx.params;
    const slugParsed = parseMenuSlug(slugParam);
    if (!slugParsed.ok) {
        return NextResponse.json({ ok: false, error: "menu_not_found" }, { status: 404 });
    }

    const limited = await enforcePublicMenuRateLimit(
        req,
        "public_menu_events",
        slugParsed.slug,
        RL_LIMIT
    );
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
        return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const visitorId = asOptionalUuid(body.visitorId);
    const eventType = typeof body.eventType === "string" ? body.eventType : "";
    if (!visitorId || !EVENT_TYPES.has(eventType as PublicMenuEventType)) {
        return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rpc_record_menu_page_event", {
        p_slug: slugParsed.slug,
        p_visitor_id: visitorId,
        p_event_type: eventType,
        p_product_id: asOptionalUuid(body.productId),
        p_category_id: asOptionalUuid(body.categoryId),
        p_embalagem_id: asOptionalUuid(body.embalagemId),
        p_utm_source: typeof body.utmSource === "string" ? body.utmSource.slice(0, 80) : null,
        p_utm_medium: typeof body.utmMedium === "string" ? body.utmMedium.slice(0, 80) : null,
        p_utm_campaign: typeof body.utmCampaign === "string" ? body.utmCampaign.slice(0, 120) : null,
        p_referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null,
    });

    if (error) {
        const msg = error.message ?? "";
        if (msg.includes("menu_not_found")) {
            return NextResponse.json({ ok: false, error: "menu_not_found" }, { status: 404 });
        }
        console.error("[public-menu] record event:", msg);
        return NextResponse.json({ ok: false, error: "event_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data });
}
