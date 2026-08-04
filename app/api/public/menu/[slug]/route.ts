import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";

export const runtime = "nodejs";

const RL_LIMIT = 90;
const RL_WINDOW_MS = 60_000;

function requesterIp(req: NextRequest): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * GET /api/public/menu/[slug]
 * Cardápio público tipado (sem auth). Rate-limited por IP.
 */
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const rl = checkRateLimit(`public_menu:${requesterIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
    if (!rl.allowed) {
        return NextResponse.json(
            { ok: false, error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const { slug: slugParam } = await ctx.params;
    const slugParsed = parseMenuSlug(slugParam);
    if (!slugParsed.ok) {
        return NextResponse.json({ ok: false, error: "menu_not_found" }, { status: 404 });
    }

    const admin = createAdminClient();
    const result = await loadPublicMenuBySlug(admin, slugParsed.slug);

    if (!result.ok) {
        const status = result.error === "menu_inactive" ? 403 : 404;
        return NextResponse.json(result, { status });
    }

    return NextResponse.json(result, {
        headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
    });
}
