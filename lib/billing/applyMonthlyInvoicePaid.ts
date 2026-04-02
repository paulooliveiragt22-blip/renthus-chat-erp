/**
 * Efeito de negócio quando uma fatura de mensalidade (metadata invoice) é paga.
 * Usado pelo webhook Pagar.me e pelo fluxo de cartão com captura imediata.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";

type Admin = ReturnType<typeof createAdminClient>;

export function nextBillingDate(activatedAt: Date, referenceDate: Date): Date {
    const next = new Date(activatedAt);
    next.setMonth(referenceDate.getMonth());
    next.setFullYear(referenceDate.getFullYear());

    if (next <= referenceDate) {
        next.setMonth(next.getMonth() + 1);
    }

    return next;
}

export type ApplyMonthlyInvoiceResult =
    | { ok: true; alreadyPaid?: boolean }
    | { ok: false; reason: "invoice_not_found" };

export async function applyMonthlyInvoicePaid(
    admin: Admin,
    orderId: string,
    opts?: { pagarmeCustomerId?: string | null }
): Promise<ApplyMonthlyInvoiceResult> {
    const { data: inv } = await admin
        .from("invoices")
        .select("id, subscription_id, company_id, status")
        .eq("pagarme_order_id", orderId)
        .maybeSingle();

    if (!inv) return { ok: false, reason: "invoice_not_found" };

    if (inv.status === "paid") {
        return { ok: true, alreadyPaid: true };
    }

    const paidAt = new Date();

    await admin
        .from("invoices")
        .update({ status: "paid", paid_at: paidAt.toISOString() })
        .eq("id", inv.id);

    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, activated_at, plan")
        .eq("id", inv.subscription_id)
        .maybeSingle();

    const nextBillingAt = sub?.activated_at
        ? nextBillingDate(new Date(sub.activated_at), paidAt)
        : new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subPatch: Record<string, unknown> = {
        status:          "active",
        last_paid_at:    paidAt.toISOString(),
        next_billing_at: nextBillingAt.toISOString(),
    };

    const cid = opts?.pagarmeCustomerId?.trim();
    if (cid) subPatch.pagarme_customer_id = cid;

    await admin.from("pagarme_subscriptions").update(subPatch).eq("id", inv.subscription_id);

    const companyId = inv.company_id as string;
    await admin.from("companies").update({ is_active: true }).eq("id", companyId);

    if (sub?.plan) {
        await syncLogicalSubscription(admin, companyId, sub.plan as string);
    }

    console.log(
        `[applyMonthlyInvoicePaid] Invoice ${inv.id} paga (order ${orderId}). Próxima cobrança: ${nextBillingAt.toISOString()}`
    );

    return { ok: true };
}
