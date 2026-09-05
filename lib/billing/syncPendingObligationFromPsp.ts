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
import type { PspFulfillMetaType } from "@/lib/billing/pspMetaTypes";

type Admin = ReturnType<typeof createAdminClient>;

export type SyncPendingFromPspResult = {
    action: "fulfilled" | "pending" | "noop" | "error";
    kind?: "invoice";
    order_id?: string;
    error?: string;
    alreadyDone?: boolean;
    /** Quantos pending com order_id foram inspecionados (H4.5). */
    checked?: number;
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
    metaType: PspFulfillMetaType
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
 * Para a company: todos os invoices pending com order PSP (≤2 por R6 kind unique).
 */
export async function syncPendingObligationFromPsp(
    admin: Admin,
    companyId: string
): Promise<SyncPendingFromPspResult> {
    const { data: rows } = await admin
        .from("invoices")
        .select("id, pagarme_order_id, kind")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    const withOrder = (rows ?? []).filter(
        (r) => typeof r.pagarme_order_id === "string" && r.pagarme_order_id.trim()
    );

    if (withOrder.length === 0) {
        return { action: "noop", checked: 0 };
    }

    let lastPending: SyncPendingFromPspResult | null = null;
    let lastError: SyncPendingFromPspResult | null = null;

    for (const inv of withOrder) {
        const orderId = String(inv.pagarme_order_id);
        const kindRaw = String(inv.kind ?? "subscription");
        const metaType: PspFulfillMetaType =
            kindRaw === "plan_upgrade"
                ? "plan_upgrade"
                : kindRaw === "period_switch"
                  ? "period_switch"
                  : "invoice";
        const r = await fulfillIfPagarmeOrderPaid(admin, orderId, metaType);
        if (r.error) {
            lastError = {
                action: "error",
                kind: metaType === "invoice" ? "invoice" : undefined,
                order_id: orderId,
                error: r.error,
                checked: withOrder.length,
            };
            continue;
        }
        if (r.fulfilled) {
            billingLog("psp_sync", "fulfilled", {
                company_id: companyId,
                kind: metaType,
                order_id: orderId,
                already_done: r.alreadyDone ?? false,
            });
            return {
                action: "fulfilled",
                kind: metaType === "invoice" ? "invoice" : undefined,
                order_id: orderId,
                alreadyDone: r.alreadyDone,
                checked: withOrder.length,
            };
        }
        lastPending = {
            action: "pending",
            kind: metaType === "invoice" ? "invoice" : undefined,
            order_id: orderId,
            checked: withOrder.length,
        };
    }

    if (lastError && !lastPending) return lastError;
    return lastPending ?? { action: "noop", checked: withOrder.length };
}
