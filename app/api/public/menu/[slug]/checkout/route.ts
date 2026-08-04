import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { publicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import { createWebMenuOrder } from "@/lib/public-menu/checkout/createWebMenuOrder";
import type { PublicMenuCheckoutInput } from "@/src/types/contracts.public-menu";

export const runtime = "nodejs";

/**
 * POST /api/public/menu/[slug]/checkout
 * Cria pedido `source=web_menu` (preços e delivery validados no servidor).
 */
export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const rl = publicMenuRateLimit(req, "public_menu_checkout", 12);
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

    const body = (await req.json().catch(() => ({}))) as PublicMenuCheckoutInput & {
        sessionToken?: string;
    };

    const sessionToken = String(body.sessionToken ?? "").trim();
    if (!sessionToken) {
        return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }

    const admin = createAdminClient();
    const menu = await loadPublicMenuBySlug(admin, slugParsed.slug);
    if (!menu.ok) {
        const status = menu.error === "menu_inactive" ? 403 : 404;
        return NextResponse.json({ ok: false, error: menu.error }, { status });
    }

    const result = await createWebMenuOrder(admin, {
        companyId: menu.menu.store.companyId,
        slug: slugParsed.slug,
        sessionToken,
        input: {
            items: body.items,
            paymentMethod: body.paymentMethod,
            changeFor: body.changeFor,
            savedAddressId: body.savedAddressId,
            newAddress: body.newAddress,
        },
    });

    if (!result.ok) {
        const status =
            result.error === "session_invalid"
                ? 401
                : result.error === "delivery_not_served" || result.error === "min_order_not_met"
                  ? 422
                  : 400;
        return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
}
