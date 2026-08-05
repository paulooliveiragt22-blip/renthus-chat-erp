/**
 * POST /api/admin/ai-wallet/checkout
 * Body: { packCents: 1000|2000|5000, method?: "pix" }
 * Cria cobrança PIX no Pagar.me; webhook credita a carteira (metadata.type=ai_pack).
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { ensureAiWallet } from "@/lib/billing/aiWallet";

export const runtime = "nodejs";

const PACKS = new Set([1000, 2000, 5000]);

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        packCents?: number;
        method?: string;
    };
    const packCents = Number(body.packCents);
    if (!PACKS.has(packCents)) {
        return NextResponse.json({ error: "pack_invalid" }, { status: 400 });
    }

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

    const brl = centsToBRL(packCents);
    const description = `Crédito IA Renthus — R$ ${brl.toFixed(2).replace(".", ",")}`;

    try {
        const customerPayload = buildPagarmeCustomerPayload({
            id: companyId,
            name: (company.name as string | null) ?? null,
            nome_fantasia: (company.nome_fantasia as string | null) ?? null,
            email: (company.email as string | null) ?? null,
            whatsapp_phone:
                (company.whatsapp_phone as string | null) ??
                (company.phone as string | null) ??
                null,
            cnpj: (company.cnpj as string | null) ?? null,
        });
        const created = await createPixInvoiceOrder({
            amountCents: packCents,
            description,
            itemCode: `ai_pack_${packCents}`,
            expiresInSeconds: 3600,
            customerId,
            customer: customerId ? undefined : customerPayload,
            metadata: {
                type: "ai_pack",
                company_id: companyId,
                pack_cents: String(packCents),
            },
        });

        const { order, pixCode, pixUrl } = await resolvePixFromOrder(created);

        if (!pixCode && !pixUrl) {
            return NextResponse.json(
                { error: "pix_payload_missing", orderId: order.id },
                { status: 502 }
            );
        }

        return NextResponse.json({
            ok: true,
            orderId: order.id,
            amountBrl: brl,
            packCents,
            // Docs: qr_code = EMV copia-e-cola; qr_code_url = imagem
            pixQrCode: pixCode,
            pixUrl,
            hasCopyPaste: Boolean(pixCode),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ai-wallet/checkout]", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
