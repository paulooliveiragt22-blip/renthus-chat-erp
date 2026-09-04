/**
 * POST /api/billing/seats/purchase
 * Compra 1 seat (proration) via PIX — libera capacidade após webhook/fulfill.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireBillingActive } from "@/lib/billing/requireBillingActive";
import { ensureSeatAddCheckout } from "@/lib/billing/ensureSeatAddCheckout";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const SEAT_PURCHASE_RL = 8;
const SEAT_PURCHASE_WINDOW_MS = 60_000;

export async function POST(_req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const billing = await requireBillingActive(admin, companyId);
    if (!billing.ok) {
        return NextResponse.json(
            { error: billing.code, message: billing.message },
            { status: 402 }
        );
    }

    const rl = checkRateLimit(
        `seat_purchase:${companyId}`,
        SEAT_PURCHASE_RL,
        SEAT_PURCHASE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const { data: company } = await admin
        .from("companies")
        .select("id, name, nome_fantasia, email, cnpj, whatsapp_phone, phone")
        .eq("id", companyId)
        .maybeSingle();
    if (!company) {
        return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    try {
        const checkout = await ensureSeatAddCheckout(admin, {
            companyId,
            company: {
                name: company.name as string | null,
                nome_fantasia: company.nome_fantasia as string | null,
                email: company.email as string | null,
                whatsapp_phone: company.whatsapp_phone as string | null,
                phone: company.phone as string | null,
                cnpj: company.cnpj as string | null,
            },
        });

        return NextResponse.json({
            ok: true,
            invoice_id: checkout.invoiceId,
            order_id: checkout.orderId,
            amount_cents: checkout.amountCents,
            amount_brl: checkout.amountBrl,
            pix_qr_code: checkout.pixQrCode,
            pix_url: checkout.pixUrl,
            seat_quantity_after: checkout.seatQuantityAfter,
            next_billing_at: checkout.nextBillingAt,
            message:
                "Pague o PIX do seat. Após confirmação, a capacidade sobe e você pode convidar o usuário.",
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const status =
            msg === "seat_not_available"
                ? 400
                : msg === "subscription_not_eligible" || msg === "subscription_not_found"
                  ? 409
                  : msg === "already_fulfilled"
                    ? 409
                    : 502;
        return NextResponse.json({ error: msg }, { status });
    }
}
