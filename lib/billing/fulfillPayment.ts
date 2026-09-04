/**
 * FulfillPayment — único efeito pós-pago (webhook + checkout sync).
 * Invoice/setup: RPC `rpc_fulfill_obligation` (claim + sub atômico).
 * ai_pack: ledger no Node. Provision auth: pós-claim no Node.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { provisionUserAfterPaymentIfNeeded } from "@/lib/billing/pagarmeSetupPaid";
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
    return (
        e instanceof PermanentFulfillError ||
        (typeof e === "object" &&
            e != null &&
            (e as { permanent?: boolean }).permanent === true)
    );
}

export function isRetryableFulfillError(e: unknown): e is RetryableFulfillError {
    return (
        e instanceof RetryableFulfillError ||
        (typeof e === "object" &&
            e != null &&
            (e as { retryable?: boolean }).retryable === true)
    );
}

export type FulfillPaymentResult =
    | {
          ok: true;
          kind: "setup" | "invoice" | "ai_pack" | "seat_add" | "plan_upgrade" | "period_switch";
          alreadyDone?: boolean;
      }
    | { ok: true; kind: "none"; alreadyDone?: boolean };

type OrderLike = {
    id?: string;
    metadata?: Record<string, string>;
    customer?: { id?: string };
};

type RpcFulfillRow = {
    status?: string;
    kind?: string;
    company_id?: string;
    plan?: string;
    order_id?: string;
    next_billing_at?: string;
};

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

async function fulfillInvoiceViaRpc(
    admin: Admin,
    orderId: string,
    metadata: Record<string, string>,
    pagarmeCustomerId?: string | null
): Promise<FulfillPaymentResult | null> {
    const { data, error } = await admin.rpc("rpc_fulfill_obligation", {
        p_pagarme_order_id: orderId,
        p_pagarme_customer_id: pagarmeCustomerId?.trim() || null,
        p_meta_type: metadata.type ?? null,
        p_meta_plan: metadata.plan ?? null,
    });

    if (error) {
        const msg = error.message ?? String(error);
        if (/plan missing|pagarme_subscription not found|pagarme_order_id required/i.test(msg)) {
            throw new PermanentFulfillError(msg);
        }
        throw new RetryableFulfillError(msg);
    }

    const row = (data ?? {}) as RpcFulfillRow;
    const status = String(row.status ?? "");

    if (status === "not_found") {
        return null;
    }

    const kind =
        row.kind === "setup"
            ? ("setup" as const)
            : row.kind === "seat_add"
              ? ("seat_add" as const)
              : row.kind === "plan_upgrade"
                ? ("plan_upgrade" as const)
                : row.kind === "period_switch"
                  ? ("period_switch" as const)
                  : ("invoice" as const);

    if (status === "already_done") {
        return { ok: true, kind, alreadyDone: true };
    }

    if (status !== "fulfilled") {
        throw new RetryableFulfillError(
            `rpc_fulfill_obligation status inesperado: ${status || "(empty)"}`
        );
    }

    const companyId = typeof row.company_id === "string" ? row.company_id : "";
    const plan = typeof row.plan === "string" ? row.plan : "";

    if (kind === "setup" && companyId && plan) {
        await provisionUserAfterPaymentIfNeeded(admin, companyId, plan);
    }

    billingLog("invoice_paid", "obligation fulfilled via rpc", {
        order_id: orderId,
        kind,
        company_id: companyId || null,
        next_billing_at: row.next_billing_at ?? null,
    });

    return { ok: true, kind };
}

/**
 * Aplica efeitos de order.paid. Idempotente via RPC claim (L4).
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
        metaType === "seat_add" ||
        metaType === "plan_upgrade" ||
        metaType === "period_switch" ||
        metaType === undefined ||
        metaType === ""
    ) {
        const custId = extractOrderCustomerId(order as PagarmeOrder);
        const inv = await fulfillInvoiceViaRpc(admin, orderId, metadata, custId);
        if (inv) return inv;

        if (
            metaType === "invoice" ||
            metaType === "setup" ||
            metaType === "seat_add" ||
            metaType === "plan_upgrade" ||
            metaType === "period_switch"
        ) {
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
