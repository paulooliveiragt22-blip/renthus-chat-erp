import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { enforcePublicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import { verifyWebMenuCheckoutSession } from "@/lib/public-menu/sessionToken";
import { resolveMenuSessionTokenFromRequest } from "@/lib/public-menu/menuSessionFromRequest";
import {
    getCustomerOrderDetailForMenu,
    listCustomerOrdersForMenu,
} from "@/lib/public-menu/checkout/loadCustomerOrders";

export const runtime = "nodejs";

/**
 * POST /api/public/menu/[slug]/orders
 * Body: `{ sessionToken, orderId? }` — lista ou detalhe do pedido do cliente.
 * Rate limit IP+slug (B12).
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
        "public_menu_orders",
        slugParsed.slug,
        40
    );
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as {
        sessionToken?: string;
        orderId?: string;
    };

    const sessionToken = resolveMenuSessionTokenFromRequest(
        req,
        slugParsed.slug,
        body.sessionToken
    );
    const session = verifyWebMenuCheckoutSession(sessionToken);
    if (!session || session.slug !== slugParsed.slug) {
        return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }

    const admin = createAdminClient();
    const menu = await loadPublicMenuBySlug(admin, slugParsed.slug);
    if (!menu.ok) {
        const status = menu.error === "menu_inactive" ? 403 : 404;
        return NextResponse.json({ ok: false, error: menu.error }, { status });
    }
    if (session.companyId !== menu.menu.store.companyId) {
        return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }

    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (orderId) {
        const order = await getCustomerOrderDetailForMenu(
            admin,
            session.companyId,
            session.customerId,
            orderId
        );
        if (!order) {
            return NextResponse.json({ ok: false, error: "order_not_found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true, order });
    }

    const orders = await listCustomerOrdersForMenu(
        admin,
        session.companyId,
        session.customerId,
        15
    );
    return NextResponse.json({ ok: true, orders });
}
