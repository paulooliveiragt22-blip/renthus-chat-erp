/**
 * Primeira fatura (signup pay-to-start, pós-trial ou re-geração never-paid).
 *
 * Period-aware e canônico: o amount + kind (subscription|year) vêm de
 * rpc_create_billing_obligation (lê pagarme_subscriptions.billing_period e
 * calcula o valor no banco — mensal ou anual com desconto). O app nunca
 * calcula o valor; PIX/cartão só quando o cliente aciona /plano/pagar.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

type ObligationResult = {
    status?: string;
    invoice_id?: string;
    amount_cents?: number;
    kind?: string;
};

export async function createInitialInvoice(
    admin: Admin,
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    // 1) Obrigação canônica no banco (mensal ou anual conforme billing_period).
    const { data: raw, error: obErr } = await admin.rpc("rpc_create_billing_obligation", {
        p_company_id: companyId,
        p_kind: "subscription",
    });
    if (obErr) {
        throw new Error(obErr.message);
    }
    const ob = (raw ?? {}) as ObligationResult;
    const invoiceId = ob.invoice_id ?? null;
    if (!invoiceId) {
        throw new Error("obligation_no_invoice");
    }
    const amountCents = Number(ob.amount_cents ?? 0);
    const kind = String(ob.kind ?? "subscription");

    billingLog("signup_invoice", "obligation_ready", {
        company_id: companyId,
        invoice_id: invoiceId,
        kind,
        amount_cents: amountCents,
    });

    return { invoiceId, pixCode: null };
}
