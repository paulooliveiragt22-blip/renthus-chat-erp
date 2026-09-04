/**
 * Checkout de seat adicional (R3-3): proration até next_billing_at → PIX.
 * Após paid, rpc_fulfill_obligation incrementa seat_quantity.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";
import { prorateSeatExtraCents } from "@/lib/billing/subscriptionAmount";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";

type Admin = ReturnType<typeof createAdminClient>;

export type EnsureSeatAddCheckoutResult = {
    invoiceId: string;
    orderId: string;
    amountCents: number;
    amountBrl: number;
    pixQrCode: string | null;
    pixUrl: string | null;
    seatQuantityAfter: number;
    nextBillingAt: string | null;
};

export async function ensureSeatAddCheckout(
    admin: Admin,
    params: {
        companyId: string;
        company: {
            name?: string | null;
            nome_fantasia?: string | null;
            email?: string | null;
            whatsapp_phone?: string | null;
            phone?: string | null;
            cnpj?: string | null;
        };
    }
): Promise<EnsureSeatAddCheckoutResult> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, pagarme_customer_id, next_billing_at, seat_quantity"
        )
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");

    const st = String(sub.status ?? "");
    if (!["active", "trial", "overdue"].includes(st)) {
        throw new Error("subscription_not_eligible");
    }

    const pricing = await loadPlanPricing(admin, String(sub.plan ?? "essencial"));
    if (pricing.seatExtraCents == null || pricing.seatExtraCents <= 0) {
        throw new Error("seat_not_available");
    }

    const nextBillingAt = sub.next_billing_at
        ? new Date(String(sub.next_billing_at))
        : new Date(Date.now() + 30 * 86_400_000);
    const amountCents = prorateSeatExtraCents(
        pricing.seatExtraCents,
        nextBillingAt,
        new Date(),
        30
    );
    if (amountCents <= 0) throw new Error("amount_invalid");

    const currentSeats =
        typeof sub.seat_quantity === "number" && sub.seat_quantity >= 1
            ? sub.seat_quantity
            : pricing.includedSeats;

    let invoiceId: string | null = null;
    let priorOrderId: string | null = null;

    const { data: pending } = await admin
        .from("invoices")
        .select("id, pagarme_order_id, amount")
        .eq("company_id", params.companyId)
        .eq("status", "pending")
        .eq("kind", "seat_add")
        .maybeSingle();

    if (pending?.id) {
        invoiceId = pending.id;
        priorOrderId = pending.pagarme_order_id ?? null;
        const catalogBrl = centsToBRL(amountCents);
        if (Math.abs(Number(pending.amount) - catalogBrl) > 0.02) {
            await admin
                .from("invoices")
                .update({
                    amount: catalogBrl,
                    pagarme_order_id: null,
                    pagarme_payment_url: null,
                    pix_qr_code: null,
                })
                .eq("id", pending.id)
                .eq("status", "pending");
            priorOrderId = null;
        }
    } else {
        const { data: created, error: insErr } = await admin
            .from("invoices")
            .insert({
                company_id: params.companyId,
                subscription_id: sub.id,
                amount: centsToBRL(amountCents),
                status: "pending",
                kind: "seat_add",
                due_at: new Date().toISOString(),
            })
            .select("id")
            .single();
        if (insErr) {
            if (isUniqueViolation(insErr)) {
                const { data: again } = await admin
                    .from("invoices")
                    .select("id, pagarme_order_id")
                    .eq("company_id", params.companyId)
                    .eq("status", "pending")
                    .eq("kind", "seat_add")
                    .maybeSingle();
                if (!again?.id) throw new Error(insErr.message);
                invoiceId = again.id;
                priorOrderId = again.pagarme_order_id ?? null;
            } else {
                throw new Error(insErr.message);
            }
        } else {
            invoiceId = created!.id;
        }
    }

    if (!invoiceId) throw new Error("invoice_create_failed");

    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "invoice");
    if (recon.action === "fulfilled") {
        throw new Error("already_fulfilled");
    }

    const customerId =
        typeof sub.pagarme_customer_id === "string" ? sub.pagarme_customer_id : undefined;
    const customerPayload = buildPagarmeCustomerPayload({
        id: params.companyId,
        name: params.company.name ?? null,
        nome_fantasia: params.company.nome_fantasia ?? null,
        email: params.company.email ?? null,
        whatsapp_phone: params.company.whatsapp_phone ?? params.company.phone ?? null,
        cnpj: params.company.cnpj ?? null,
    });

    const created = await createPixInvoiceOrder({
        amountCents,
        description: `Seat adicional Renthus — prorata até renovação`,
        itemCode: "seat_add",
        expiresInSeconds: 3600,
        customerId,
        customer: customerId ? undefined : customerPayload,
        metadata: {
            type: "seat_add",
            company_id: params.companyId,
            subscription_id: String(sub.id),
            plan: String(sub.plan ?? ""),
            seats: "1",
            invoice_id: invoiceId,
        },
    });

    const { order, pixCode, pixUrl } = await resolvePixFromOrder(created);
    if (!pixCode && !pixUrl) {
        throw new Error("pix_payload_missing");
    }

    await admin
        .from("invoices")
        .update({
            pagarme_order_id: order.id,
            pagarme_payment_url: pixUrl,
            pix_qr_code: pixCode,
            amount: centsToBRL(amountCents),
        })
        .eq("id", invoiceId);

    return {
        invoiceId,
        orderId: order.id,
        amountCents,
        amountBrl: centsToBRL(amountCents),
        pixQrCode: pixCode,
        pixUrl,
        seatQuantityAfter: currentSeats + 1,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
