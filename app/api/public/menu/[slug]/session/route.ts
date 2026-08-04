import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { publicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import { normalizeBrPhone } from "@/lib/public-menu/phone";
import { resolveWebMenuCustomer } from "@/lib/public-menu/resolveWebCustomer";
import { listCustomerAddressesForMenu } from "@/lib/public-menu/checkout/addresses";
import {
    signWebMenuCheckoutSession,
    verifyWebMenuLinkToken,
} from "@/lib/public-menu/sessionToken";

export const runtime = "nodejs";

/**
 * POST /api/public/menu/[slug]/session
 * Body: `{ wmToken }` (link WhatsApp) OU `{ phone, name? }` (cadastro manual).
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
    const slugParsed = parseMenuSlug(slugParam);
    if (!slugParsed.ok) {
        return NextResponse.json({ ok: false, error: "menu_not_found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
        wmToken?: string;
        phone?: string;
        name?: string;
    };

    const admin = createAdminClient();
    const menu = await loadPublicMenuBySlug(admin, slugParsed.slug);
    if (!menu.ok) {
        const status = menu.error === "menu_inactive" ? 403 : 404;
        return NextResponse.json(menu, { status });
    }

    const companyId = menu.menu.store.companyId;
    let phoneRaw = "";
    const name: string | null = typeof body.name === "string" ? body.name.trim() : null;

    const wmToken = typeof body.wmToken === "string" ? body.wmToken.trim() : "";
    if (wmToken) {
        const link = verifyWebMenuLinkToken(wmToken);
        if (!link || link.companyId !== companyId || link.slug !== slugParsed.slug) {
            return NextResponse.json({ ok: false, error: "token_invalid" }, { status: 401 });
        }
        phoneRaw = link.phoneE164;
    } else {
        phoneRaw = typeof body.phone === "string" ? body.phone : "";
        if (!phoneRaw.trim()) {
            return NextResponse.json({ ok: false, error: "phone_invalid" }, { status: 400 });
        }
    }

    const phoneNorm = normalizeBrPhone(phoneRaw);
    if (!phoneNorm.ok) {
        return NextResponse.json({ ok: false, error: "phone_invalid" }, { status: 400 });
    }

    if (!wmToken) {
        const { data: exist } = await admin
            .from("customers")
            .select("id")
            .eq("company_id", companyId)
            .or(
                `phone_e164.eq.${phoneNorm.phoneE164},phone.eq.${phoneNorm.digits},phone.eq.${phoneNorm.phoneE164}`
            )
            .limit(1)
            .maybeSingle();
        if (!exist?.id && !name) {
            return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
        }
    }

    const customer = await resolveWebMenuCustomer(admin, companyId, phoneRaw, name);
    if (!customer) {
        return NextResponse.json({ ok: false, error: "customer_failed" }, { status: 500 });
    }

    const addresses = await listCustomerAddressesForMenu(admin, companyId, customer.id);
    const sessionToken = signWebMenuCheckoutSession({
        companyId,
        customerId: customer.id,
        phoneE164: customer.phoneE164,
        slug: slugParsed.slug,
        name: customer.name,
    });

    return NextResponse.json({
        ok: true,
        sessionToken,
        customer: {
            id: customer.id,
            name: customer.name,
            phoneE164: customer.phoneE164,
            isNew: customer.isNew,
        },
        addresses,
    });
}
