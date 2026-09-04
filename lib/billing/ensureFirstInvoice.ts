/**
 * Garante a 1ª invoice pending (canônica, period-aware) + PIX best-effort.
 *
 * Delega para createInitialInvoice, que cria a obrigação via
 * rpc_create_billing_obligation (amount + kind subscription|year no banco).
 * Usado pela re-geração de fatura de tenant never-paid (superadmin).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createInitialInvoice } from "@/lib/billing/createInitialInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export async function ensureFirstInvoice(
    admin: Admin,
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    try {
        return await createInitialInvoice(admin, companyId);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        billingLog("ensure_first_invoice", "error", { company_id: companyId, error: msg });
        throw e instanceof Error ? e : new Error(msg);
    }
}
