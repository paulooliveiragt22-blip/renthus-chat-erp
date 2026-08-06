import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import { publicMenuRateLimit } from "@/lib/public-menu/publicApiHelpers";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";
import { lookupCep, sanitizeCep } from "@/lib/address/cepLookup";
import { verifyWebMenuCheckoutSession } from "@/lib/public-menu/sessionToken";
import { listCustomerAddressesForMenu } from "@/lib/public-menu/checkout/addresses";

export const runtime = "nodejs";

/**
 * POST /api/public/menu/[slug]/delivery-quote
 * Body: `{ sessionToken, neighborhood? , savedAddressId?, cep? }`
 */
export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> }
) {
    const rl = publicMenuRateLimit(req, "public_menu_quote", 60);
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
        sessionToken?: string;
        neighborhood?: string;
        savedAddressId?: string;
        cep?: string;
    };

    const session = verifyWebMenuCheckoutSession(String(body.sessionToken ?? ""));
    if (
        !session ||
        session.slug !== slugParsed.slug ||
        session.needsPhone ||
        !session.phoneE164?.trim()
    ) {
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

    let cepLookup: {
        logradouro: string;
        bairro: string;
        cidade: string;
        estado: string;
        cep: string;
    } | null = null;

    let neighborhood = String(body.neighborhood ?? "").trim();

    if (body.savedAddressId) {
        const addresses = await listCustomerAddressesForMenu(
            admin,
            session.companyId,
            session.customerId
        );
        const found = addresses.find((a) => a.id === String(body.savedAddressId));
        if (!found) {
            return NextResponse.json({ ok: false, error: "address_not_found" }, { status: 404 });
        }
        neighborhood = found.bairro ?? "";
    } else if (body.cep) {
        const looked = await lookupCep(sanitizeCep(String(body.cep)));
        if (looked) {
            cepLookup = {
                logradouro: looked.logradouro,
                bairro: looked.bairro,
                cidade: looked.localidade,
                estado: looked.uf,
                cep: looked.cep,
            };
            if (!neighborhood) neighborhood = looked.bairro;
        }
    }

    if (!neighborhood) {
        return NextResponse.json({ ok: false, error: "neighborhood_required" }, { status: 400 });
    }

    const delivery = await resolveDeliveryForNeighborhood(
        admin,
        session.companyId,
        neighborhood
    );

    return NextResponse.json({
        ok: true,
        served: delivery.served,
        fee: delivery.fee,
        minOrder: delivery.min_order,
        etaMin: delivery.eta_min,
        label: delivery.label,
        reason: delivery.reason,
        cepLookup,
    });
}
