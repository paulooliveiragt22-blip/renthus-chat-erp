/**
 * Garante invoice pending idempotente (RPC) + best-effort PIX Pagar.me.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getMonthlyPriceCents, centsToBRL } from "@/lib/billing/pagarme";
import { normalizePlanKey } from "@/lib/billing/planCatalog";
import { createInitialMonthlyInvoice } from "@/lib/billing/createInitialMonthlyInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export async function ensureFirstInvoice(
    admin: Admin,
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("plan")
        .eq("company_id", companyId)
        .maybeSingle();

    const planKey = normalizePlanKey(String(sub?.plan ?? "")) ?? "essencial";
    const amountBrl = centsToBRL(getMonthlyPriceCents(planKey));

    const { data: invoiceId, error } = await admin.rpc("rpc_ensure_first_invoice", {
        p_company_id: companyId,
        p_amount: amountBrl,
    });

    if (error) {
        throw new Error(error.message);
    }

    if (!invoiceId) {
        return { invoiceId: null, pixCode: null };
    }

    const { data: inv } = await admin
        .from("invoices")
        .select("pagarme_order_id, pix_qr_code")
        .eq("id", invoiceId)
        .maybeSingle();

    if (inv?.pagarme_order_id && inv.pix_qr_code) {
        return {
            invoiceId: String(invoiceId),
            pixCode: inv.pix_qr_code,
        };
    }

    try {
        const created = await createInitialMonthlyInvoice(admin, companyId);
        billingLog("ensure_first_invoice", "pagarme_backfill", {
            company_id: companyId,
            invoice_id: created.invoiceId,
        });
        return created;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        billingLog("ensure_first_invoice", "pagarme_skipped", {
            company_id: companyId,
            error: msg,
        });
        return { invoiceId: String(invoiceId), pixCode: null };
    }
}
