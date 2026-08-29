/**
 * Processa outbox ai_recharge_jobs (cron). Cobrança card; crédito só FulfillPayment.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createOrderWithSavedCard,
    isOrderCreditPaid,
    listCustomerCards,
} from "@/lib/billing/pagarme";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

const AI_RECHARGE_BATCH = 20;

export type ProcessAiRechargeResult = {
    processed: number;
    paid: number;
    failed: number;
    errors: string[];
};

type JobRow = {
    id: string;
    company_id: string;
    pack_cents: number;
    attempt_count: number;
};

async function resolveCardId(
    admin: Admin,
    companyId: string,
    customerId: string
): Promise<string | null> {
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("default_card_id")
        .eq("company_id", companyId)
        .maybeSingle();

    const defaultId = sub?.default_card_id?.trim();
    if (defaultId) {
        const cards = await listCustomerCards(customerId);
        if (cards.some((c) => c.id === defaultId)) return defaultId;
    }

    const cards = await listCustomerCards(customerId);
    return cards.find((c) => c.status === "active" || !c.status)?.id ?? cards[0]?.id ?? null;
}

export async function processAiRechargeJobs(admin: Admin): Promise<ProcessAiRechargeResult> {
    const result: ProcessAiRechargeResult = {
        processed: 0,
        paid: 0,
        failed: 0,
        errors: [],
    };

    const { data: jobs, error: fetchErr } = await admin
        .from("ai_recharge_jobs")
        .select("id, company_id, pack_cents, attempt_count")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(AI_RECHARGE_BATCH);

    if (fetchErr) {
        result.errors.push(fetchErr.message);
        return result;
    }

    for (const job of (jobs ?? []) as JobRow[]) {
        result.processed++;
        const now = new Date().toISOString();

        const { data: claimed } = await admin
            .from("ai_recharge_jobs")
            .update({ status: "processing", updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending")
            .select("id")
            .maybeSingle();

        if (!claimed) continue;

        try {
            const { data: pagarmeSub } = await admin
                .from("pagarme_subscriptions")
                .select("pagarme_customer_id")
                .eq("company_id", job.company_id)
                .maybeSingle();

            const customerId = pagarmeSub?.pagarme_customer_id?.trim();
            if (!customerId) {
                throw new Error("sem pagarme_customer_id");
            }

            const cardId = await resolveCardId(admin, job.company_id, customerId);
            if (!cardId) {
                throw new Error("sem cartão salvo");
            }

            const pack = job.pack_cents as 1000 | 2000 | 5000;
            const brl = (pack / 100).toFixed(2).replace(".", ",");
            const order = await createOrderWithSavedCard({
                amountCents: pack,
                description: `Crédito IA automático Renthus — R$ ${brl}`,
                itemCode: `ai_pack_auto_${pack}`,
                customerId,
                cardId,
                recurrence: false,
                metadata: {
                    type: "ai_pack",
                    company_id: job.company_id,
                    pack_cents: String(pack),
                    source: "auto_recharge",
                    job_id: job.id,
                },
            });

            await admin
                .from("ai_recharge_jobs")
                .update({
                    pagarme_order_id: order.id,
                    attempt_count: job.attempt_count + 1,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", job.id);

            if (!isOrderCreditPaid(order)) {
                throw new Error(`cartão não aprovado: ${order.status}`);
            }

            await fulfillPayment(admin, {
                id: order.id,
                metadata: {
                    type: "ai_pack",
                    company_id: job.company_id,
                    pack_cents: String(pack),
                    source: "auto_recharge",
                },
            });

            await admin
                .from("ai_recharge_jobs")
                .update({
                    status: "completed",
                    processed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    last_error: null,
                })
                .eq("id", job.id);

            await admin
                .from("company_ai_wallets")
                .update({
                    auto_recharge_last_error: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("company_id", job.company_id);

            result.paid++;
            billingLog("ai_recharge", "paid", {
                company_id: job.company_id,
                job_id: job.id,
                order_id: order.id,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.failed++;
            result.errors.push(`job ${job.id}: ${msg}`);

            await admin
                .from("ai_recharge_jobs")
                .update({
                    status: "failed",
                    last_error: msg.slice(0, 500),
                    attempt_count: job.attempt_count + 1,
                    processed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", job.id);

            await admin
                .from("company_ai_wallets")
                .update({
                    auto_recharge_last_error: msg.slice(0, 500),
                    updated_at: new Date().toISOString(),
                })
                .eq("company_id", job.company_id);

            billingLog("ai_recharge", "failed", {
                company_id: job.company_id,
                job_id: job.id,
                error: msg,
            });
        }
    }

    return result;
}
