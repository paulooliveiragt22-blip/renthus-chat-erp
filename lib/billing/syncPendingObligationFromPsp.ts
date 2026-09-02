/**
 * Rede de segurança sob demanda (ADR-0004 B2):
 * se a obrigação local está pending com `pagarme_order_id` e o PSP já está paid,
 * chama o mesmo `fulfillPayment` do webhook — não substitui ingestão.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getPagarmeOrder, isOrderCreditPaid, type PagarmeOrder } from "@/lib/billing/pagarme";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type SyncPendingFromPspResult = {
    action: "fulfilled" | "pending" | "noop" | "error";
    kind?: "setup" | "invoice";
    order_id?: string;
    error?: string;
    alreadyDone?: boolean;
};

function isPspPaid(order: PagarmeOrder): boolean {
    if (isOrderCreditPaid(order)) return true;
    return String(order.status ?? "").toLowerCase() === "paid";
}

/**
 * GET order no PSP; se paid → fulfill. Usado por sync tenant e rebill.
 */
export async function fulfillIfPagarmeOrderPaid(
    admin: Admin,
    orderId: string,
    metaType: "invoice" | "setup"
): Promise<{ fulfilled: boolean; alreadyDone?: boolean; error?: string }> {
    try {
        const order = await getPagarmeOrder(orderId);
        if (!isPspPaid(order)) {
            return { fulfilled: false };
        }
        const result = await fulfillPayment(admin, {
            id: order.id,
            metadata: {
                ...(order.metadata as Record<string, string> | undefined),
                type: metaType,
            },
            customer: order.customer,
        });
        const alreadyDone = Boolean(
            result.ok && "alreadyDone" in result && result.alreadyDone
        );
        return { fulfilled: true, alreadyDone };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        billingLog("psp_sync", "fulfill_check_failed", { order_id: orderId, error: msg });
        return { fulfilled: false, error: msg };
    }
}

/**
 * Para a company: setup pending ou invoice pending com order PSP → fulfill se paid.
 * Preferência: setup primeiro (primeiro pagamento).
 */
export async function syncPendingObligationFromPsp(
    admin: Admin,
    companyId: string
): Promise<SyncPendingFromPspResult> {
    const { data: setup } = await admin
        .from("setup_payments")
        .select("id, pagarme_order_id")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (setup?.pagarme_order_id) {
        const r = await fulfillIfPagarmeOrderPaid(admin, setup.pagarme_order_id, "setup");
        if (r.error) {
            return {
                action: "error",
                kind: "setup",
                order_id: setup.pagarme_order_id,
                error: r.error,
            };
        }
        if (r.fulfilled) {
            billingLog("psp_sync", "fulfilled", {
                company_id: companyId,
                kind: "setup",
                order_id: setup.pagarme_order_id,
                already_done: r.alreadyDone ?? false,
            });
            return {
                action: "fulfilled",
                kind: "setup",
                order_id: setup.pagarme_order_id,
                alreadyDone: r.alreadyDone,
            };
        }
        return { action: "pending", kind: "setup", order_id: setup.pagarme_order_id };
    }

    const { data: inv } = await admin
        .from("invoices")
        .select("id, pagarme_order_id")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!inv?.pagarme_order_id) {
        return { action: "noop" };
    }

    const r = await fulfillIfPagarmeOrderPaid(admin, inv.pagarme_order_id, "invoice");
    if (r.error) {
        return {
            action: "error",
            kind: "invoice",
            order_id: inv.pagarme_order_id,
            error: r.error,
        };
    }
    if (r.fulfilled) {
        billingLog("psp_sync", "fulfilled", {
            company_id: companyId,
            kind: "invoice",
            order_id: inv.pagarme_order_id,
            already_done: r.alreadyDone ?? false,
        });
        return {
            action: "fulfilled",
            kind: "invoice",
            order_id: inv.pagarme_order_id,
            alreadyDone: r.alreadyDone,
        };
    }
    return { action: "pending", kind: "invoice", order_id: inv.pagarme_order_id };
}
