/**
 * POST /api/admin/ai-wallet/checkout
 * Body: { packCents: 1000|2000|5000 }
 * PIX pack — crédito só via webhook FulfillPayment.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { ensureAiWallet } from "@/lib/billing/aiWallet";
import { ensureAiPackCheckout } from "@/lib/billing/ensureAiPackCheckout";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const AI_WALLET_CHECKOUT_RATE_LIMIT = 10;
const AI_WALLET_CHECKOUT_RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const rl = checkRateLimit(
        `ai_wallet_checkout:${companyId}`,
        AI_WALLET_CHECKOUT_RATE_LIMIT,
        AI_WALLET_CHECKOUT_RATE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const body = (await req.json().catch(() => ({}))) as { packCents?: number };
    const packCents = Number(body.packCents);

    await ensureAiWallet(admin, companyId);

    const { data: company } = await admin
        .from("companies")
        .select("id, name, nome_fantasia, email, cnpj, whatsapp_phone, phone")
        .eq("id", companyId)
        .maybeSingle();

    if (!company) {
        return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    const { data: pagarmeSub } = await admin
        .from("pagarme_subscriptions")
        .select("pagarme_customer_id")
        .eq("company_id", companyId)
        .maybeSingle();

    const customerId =
        typeof pagarmeSub?.pagarme_customer_id === "string"
            ? pagarmeSub.pagarme_customer_id
            : undefined;

    try {
        const checkout = await ensureAiPackCheckout(admin, {
            companyId,
            packCents,
            customerId,
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
            orderId: checkout.orderId,
            amountBrl: checkout.amountBrl,
            packCents: checkout.packCents,
            pixQrCode: checkout.pixQrCode,
            pixUrl: checkout.pixUrl,
            hasCopyPaste: Boolean(checkout.pixQrCode),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "pack_invalid") {
            return NextResponse.json({ error: "pack_invalid" }, { status: 400 });
        }
        if (msg === "pix_payload_missing") {
            return NextResponse.json({ error: "pix_payload_missing" }, { status: 502 });
        }
        console.error("[ai-wallet/checkout]", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
