import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { publicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import {
    establishMenuSessionFromWmToken,
    readMenuSessionFromToken,
} from "@/lib/public-menu/establishMenuSession";
import {
    readMenuSessionCookie,
    setMenuSessionCookie,
    clearMenuSessionCookie,
} from "@/lib/public-menu/menuSessionCookie";

export const runtime = "nodejs";

async function loadMenuOr404(slugParam: string) {
    const slugParsed = parseMenuSlug(slugParam);
    if (!slugParsed.ok) {
        return { error: NextResponse.json({ ok: false, error: "menu_not_found" }, { status: 404 }) };
    }
    const admin = createAdminClient();
    const menu = await loadPublicMenuBySlug(admin, slugParsed.slug);
    if (!menu.ok) {
        const status = menu.error === "menu_inactive" ? 403 : 404;
        return { error: NextResponse.json({ ok: false, error: menu.error }, { status }) };
    }
    return { admin, menu, slug: slugParsed.slug };
}

/**
 * GET /api/public/menu/[slug]/session
 * Lê sessão do cookie HttpOnly (sem expor token ao JS).
 */
export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const { slug: slugParam } = await ctx.params;
    const loaded = await loadMenuOr404(slugParam);
    if ("error" in loaded && loaded.error) return loaded.error;
    const { admin, menu, slug } = loaded as Exclude<typeof loaded, { error: NextResponse }>;

    const cookieToken = await readMenuSessionCookie(slug);
    if (!cookieToken) {
        return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }

    const session = await readMenuSessionFromToken(admin, {
        companyId: menu.menu.store.companyId,
        slug,
        sessionToken: cookieToken,
    });
    if (!session) {
        const res = NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
        clearMenuSessionCookie(res, slug);
        return res;
    }

    return NextResponse.json(session);
}

/**
 * POST /api/public/menu/[slug]/session
 * Body:
 * - `{ wmToken }` — link assinado v1 (phone) ou v2 (channel+externalId)
 * - `{ wmToken, phone, name? }` — completa phone quando `needsPhone` (IG/Messenger)
 */
export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const rl = publicMenuRateLimit(req, "public_menu_session", 30);
    if (!rl.allowed) {
        return NextResponse.json(
            { ok: false, error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const { slug: slugParam } = await ctx.params;
    const loaded = await loadMenuOr404(slugParam);
    if ("error" in loaded && loaded.error) return loaded.error;
    const { admin, menu, slug } = loaded as Exclude<typeof loaded, { error: NextResponse }>;

    const body = (await req.json().catch(() => ({}))) as {
        wmToken?: string;
        phone?: string;
        name?: string;
    };

    const result = await establishMenuSessionFromWmToken(admin, {
        companyId: menu.menu.store.companyId,
        slug,
        wmToken: typeof body.wmToken === "string" ? body.wmToken : "",
        phone: body.phone,
        name: body.name,
    });

    if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    const res = NextResponse.json(result.data);
    setMenuSessionCookie(res, slug, result.data.sessionToken);
    return res;
}
