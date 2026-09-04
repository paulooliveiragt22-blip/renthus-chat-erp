/**
 * FulfillPayment — único efeito pós-pago (webhook + checkout sync).
 * Setup | invoice mensal | ai_pack.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    activateAfterSetupPayment,
    syncLogicalSubscription,
    provisionUserAfterPaymentIfNeeded,
} from "@/lib/billing/pagarmeSetupPaid";
import { computeNextBillingAt } from "@/lib/billing/computeNextBillingAt";
import { creditAiPack } from "@/lib/billing/aiWallet";
import { billingLog } from "@/lib/billing/billingLog";
import { extractOrderCustomerId, type PagarmeOrder } from "@/lib/billing/pagarme";

type Admin = ReturnType<typeof createAdminClient>;

export class PermanentFulfillError extends Error {
    readonly permanent = true as const;
    constructor(message: string) {
        super(message);
        this.name = "PermanentFulfillError";
    }
}

export class RetryableFulfillError extends Error {
    readonly retryable = true as const;
    constructor(message: string) {
        super(message);
        this.name = "RetryableFulfillError";
    }
}

export function isPermanentFulfillError(e: unknown): e is PermanentFulfillError {
    return e instanceof PermanentFulfillError ||
        (typeof e === "object" && e != null && (e as { permanent?: boolean }).permanent === true);
}

export function isRetryableFulfillError(e: unknown): e is RetryableFulfillError {
    return e instanceof RetryableFulfillError ||
        (typeof e === "object" && e != null && (e as { retryable?: boolean }).retryable === true);
}

export type FulfillPaymentResult =
    | { ok: true; kind: "setup" | "invoice" | "ai_pack"; alreadyDone?: boolean }
    | { ok: true; kind: "none"; alreadyDone?: boolean };

type OrderLike = {
    id?: string;
    metadata?: Record<string, string>;
    customer?: { id?: string };
};

async function fulfillInvoice(
    admin: Admin,
    orderId: string,
    metadata: Record<string, string>,
    pagarmeCustomerId?: string | null
): Promise<FulfillPaymentResult | null> {
    const { data: inv, error } = await admin
        .from("invoices")
        .select("id, subscription_id, company_id, status, kind")
        .eq("pagarme_order_id", orderId)
        .maybeSingle();

    if (error) throw new RetryableFulfillError(error.message);
    if (!inv) return null;

    const isSetup = inv.kind === "setup" || metadata.type === "setup";
    const resultKind = isSetup ? "setup" as const : "invoice" as const;
    if (inv.status === "paid") {
        return { ok: true, kind: resultKind, alreadyDone: true };
    }

    const paidAt = new Date();
    const { data: claimed, error: claimErr } = await admin
        .from("invoices")
        .update({ status: "paid", paid_at: paidAt.toISOString() })
        .eq("id", inv.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

    if (claimErr) throw new RetryableFulfillError(claimErr.message);
    if (!claimed) {
        return { ok: true, kind: resultKind, alreadyDone: true };
    }

    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan")
        .eq("id", inv.subscription_id)
        .maybeSingle();

    const companyId = inv.company_id as string;
    if (isSetup) {
        const plan = String(sub?.plan ?? metadata.plan ?? "");
        if (!plan) {
            throw new PermanentFulfillError(
                `invoice de setup sem plano para order ${orderId}`
            );
        }
        await activateAfterSetupPayment(
            admin,
            companyId,
            plan,
            pagarmeCustomerId ?? undefined
        );
        await syncLogicalSubscription(admin, companyId, plan);
        await provisionUserAfterPaymentIfNeeded(admin, companyId, plan);
        return { ok: true, kind: "setup" };
    }

    const nextBillingAt = computeNextBillingAt(paidAt);
    const subPatch: Record<string, unknown> = {
        status: "active",
        last_paid_at: paidAt.toISOString(),
        next_billing_at: nextBillingAt.toISOString(),
    };
    const cid = pagarmeCustomerId?.trim();
    if (cid) subPatch.pagarme_customer_id = cid;

    const { error: subErr } = await admin
        .from("pagarme_subscriptions")
        .update(subPatch)
        .eq("id", inv.subscription_id);
    if (subErr) throw new RetryableFulfillError(subErr.message);

    await admin.from("companies").update({ is_active: true }).eq("id", companyId);

    if (sub?.plan) {
        await syncLogicalSubscription(admin, companyId, sub.plan as string);
    }

    billingLog("invoice_paid", "monthly invoice marked paid", {
        invoice_id: inv.id,
        order_id: orderId,
        company_id: companyId,
        next_billing_at: nextBillingAt.toISOString(),
    });

    return { ok: true, kind: "invoice" };
}

async function fulfillAiPack(
    admin: Admin,
    orderId: string,
    metadata: Record<string, string>
): Promise<FulfillPaymentResult | null> {
    if (metadata.type !== "ai_pack") return null;

    const companyId = String(metadata.company_id ?? "");
    const packCents = Number(metadata.pack_cents);
    if (!companyId || (packCents !== 1000 && packCents !== 2000 && packCents !== 5000)) {
        throw new PermanentFulfillError("ai_pack metadata inválida");
    }

    const { data: existingCredit, error: dupErr } = await admin
        .from("company_ai_ledger")
        .select("id")
        .eq("company_id", companyId)
        .eq("kind", "pack_credit")
        .filter("meta->>pagarme_order_id", "eq", orderId)
        .maybeSingle();

    if (dupErr) throw new RetryableFulfillError(dupErr.message);
    if (existingCredit?.id) {
        return { ok: true, kind: "ai_pack", alreadyDone: true };
    }

    await creditAiPack(admin, companyId, packCents, {
        pagarme_order_id: orderId,
        source: "pagarme_webhook",
    });
    return { ok: true, kind: "ai_pack" };
}

/**
 * Aplica efeitos de order.paid. Idempotente via optimistic lock.
 */
export async function fulfillPayment(
    admin: Admin,
    order: OrderLike
): Promise<FulfillPaymentResult> {
    const orderId = order?.id;
    if (!orderId || typeof orderId !== "string") {
        throw new PermanentFulfillError("order.paid sem order.id");
    }

    const metadata = (order.metadata ?? {}) as Record<string, string>;
    const metaType = metadata.type;

    const ai = await fulfillAiPack(admin, orderId, metadata);
    if (ai) return ai;

    if (
        metaType === "setup" ||
        metaType === "invoice" ||
        metaType === undefined ||
        metaType === ""
    ) {
        const custId = extractOrderCustomerId(order as PagarmeOrder);
        const inv = await fulfillInvoice(admin, orderId, metadata, custId);
        if (inv) return inv;

        if (metaType === "invoice" || metaType === "setup") {
            throw new PermanentFulfillError(
                `metadata.type=${metaType} sem invoice para order ${orderId}`
            );
        }
        throw new PermanentFulfillError(
            `order.paid sem invoice/ai_pack para order ${orderId}`
        );
    }

    throw new PermanentFulfillError(`metadata.type não tratado: ${metaType}`);
}
