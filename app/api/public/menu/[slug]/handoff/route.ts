import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { publicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import { verifyMenuHandoffToken } from "@/lib/public-menu/sessionToken";
import type { PublicMenuCartLine } from "@/src/types/contracts.public-menu";

export const runtime = "nodejs";

function isCartLine(v: unknown): v is PublicMenuCartLine {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return (
        typeof o.embalagemId === "string" &&
        typeof o.productId === "string" &&
        typeof o.name === "string" &&
        typeof o.unitPrice === "number" &&
        typeof o.qty === "number"
    );
}

/**
 * GET /api/public/menu/[slug]/handoff?hc=
 * Hidrata o carrinho do cardápio a partir do snapshot persistido pelo bot.
 * Leitura idempotente até expires_at (reload do WebView do WhatsApp).
 */
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const rl = publicMenuRateLimit(req, "public_menu_handoff", 40);
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

    const hc = req.nextUrl.searchParams.get("hc")?.trim() ?? "";
    if (!hc) {
        return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
    }

    let payload: ReturnType<typeof verifyMenuHandoffToken>;
    try {
        payload = verifyMenuHandoffToken(hc);
    } catch {
        return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
    }
    if (!payload || payload.slug !== slugParsed.slug) {
        return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
    }

    const admin = createAdminClient();
    const menu = await loadPublicMenuBySlug(admin, slugParsed.slug);
    if (!menu.ok) {
        const status = menu.error === "menu_inactive" ? 403 : 404;
        return NextResponse.json(menu, { status });
    }
    if (payload.companyId !== menu.menu.store.companyId) {
        return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
    }

    const { data, error } = await admin
        .from("menu_handoffs")
        .select("id, purpose, cart, expires_at")
        .eq("id", payload.handoffId)
        .eq("company_id", payload.companyId)
        .eq("slug", slugParsed.slug)
        .maybeSingle();

    if (error || !data) {
        return NextResponse.json({ ok: false, error: "handoff_not_found" }, { status: 404 });
    }
    if (new Date(String(data.expires_at)).getTime() <= Date.now()) {
        return NextResponse.json({ ok: false, error: "handoff_expired" }, { status: 410 });
    }

    const cartRaw = Array.isArray(data.cart) ? data.cart : [];
    const cart = cartRaw.filter(isCartLine);

    return NextResponse.json({
        ok: true,
        purpose: "checkout",
        cart,
    });
}
