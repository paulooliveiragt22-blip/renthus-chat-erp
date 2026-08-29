/**
 * EnsureCheckout para pack IA (PIX). Usado por /api/admin/ai-wallet/checkout.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";

type Admin = ReturnType<typeof createAdminClient>;

const PACKS = new Set([1000, 2000, 5000]);

export type EnsureAiPackCheckoutResult = {
    orderId: string;
    amountBrl: number;
    packCents: number;
    pixQrCode: string | null;
    pixUrl: string | null;
};

export async function ensureAiPackCheckout(
    admin: Admin,
    params: {
        companyId: string;
        packCents: number;
        customerId?: string;
        company: {
            name?: string | null;
            nome_fantasia?: string | null;
            email?: string | null;
            whatsapp_phone?: string | null;
            phone?: string | null;
            cnpj?: string | null;
        };
    }
): Promise<EnsureAiPackCheckoutResult> {
    const packCents = params.packCents;
    if (!PACKS.has(packCents)) {
        throw new Error("pack_invalid");
    }

    const brl = centsToBRL(packCents);
    const description = `Crédito IA Renthus — R$ ${brl.toFixed(2).replace(".", ",")}`;

    const customerPayload = buildPagarmeCustomerPayload({
        id: params.companyId,
        name: params.company.name ?? null,
        nome_fantasia: params.company.nome_fantasia ?? null,
        email: params.company.email ?? null,
        whatsapp_phone: params.company.whatsapp_phone ?? params.company.phone ?? null,
        cnpj: params.company.cnpj ?? null,
    });

    const created = await createPixInvoiceOrder({
        amountCents: packCents,
        description,
        itemCode: `ai_pack_${packCents}`,
        expiresInSeconds: 3600,
        customerId: params.customerId,
        customer: params.customerId ? undefined : customerPayload,
        metadata: {
            type: "ai_pack",
            company_id: params.companyId,
            pack_cents: String(packCents),
        },
    });

    const { order, pixCode, pixUrl } = await resolvePixFromOrder(created);

    if (!pixCode && !pixUrl) {
        throw new Error("pix_payload_missing");
    }

    return {
        orderId: order.id,
        amountBrl: brl,
        packCents,
        pixQrCode: pixCode,
        pixUrl,
    };
}
