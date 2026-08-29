/**
 * Efeito de negócio quando uma fatura de mensalidade é paga.
 * Delega a fulfillPayment (fonte única).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";

type Admin = ReturnType<typeof createAdminClient>;

export type ApplyMonthlyInvoiceResult =
    | { ok: true; alreadyPaid?: boolean }
    | { ok: false; reason: "invoice_not_found" };

export async function applyMonthlyInvoicePaid(
    admin: Admin,
    orderId: string,
    opts?: { pagarmeCustomerId?: string | null }
): Promise<ApplyMonthlyInvoiceResult> {
    try {
        const r = await fulfillPayment(admin, {
            id: orderId,
            metadata: { type: "invoice" },
            customer: opts?.pagarmeCustomerId
                ? { id: opts.pagarmeCustomerId }
                : undefined,
        });
        if (r.kind === "invoice") {
            return { ok: true, alreadyPaid: r.alreadyDone };
        }
        return { ok: false, reason: "invoice_not_found" };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/sem invoice|invoice_not_found|metadata\.type=invoice/i.test(msg)) {
            return { ok: false, reason: "invoice_not_found" };
        }
        throw e;
    }
}
