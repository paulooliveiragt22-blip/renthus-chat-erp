import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { enforcePublicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";

export const runtime = "nodejs";

const RL_LIMIT = 90;

/**
 * GET /api/public/menu/[slug]
 * Cardápio público tipado (sem auth). Rate-limited por IP+slug (B12).
 */
export async function GET(
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
        "public_menu",
        slugParsed.slug,
        RL_LIMIT
    );
    if (limited) return limited;

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
