/**
 * POST /api/billing/charge
 *
 * Cron diário (Vercel, 08:00 BRT) — vercel.json: "0 11 * * *" (UTC)
 *
 * 1. trial/active vencido → CollectPayment (card-first se default_card_id; senão PIX)
 * 2. overdue de quem JÁ pagou: D1/D3/D5 retry card + WA; D7 block (BN-13)
 * 3. never-paid NÃO bloqueia aqui — lifecycle → abandoned é do cron mark-abandoned (14d)
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import {
    sendBillingNotification,
    buildOverdueMessage,
} from "@/lib/billing/sendBillingNotification";
import { billingLog } from "@/lib/billing/billingLog";
import { collectPayment, type CollectSub } from "@/lib/billing/collectPayment";
import { resolveCollectionActionDb } from "@/lib/billing/collectionPolicy";
import { processAiRechargeJobs } from "@/lib/billing/processAiRechargeJobs";
import { transitionBillingStatus } from "@/lib/billing/transitionBillingStatus";

export const runtime = "nodejs";

const CHARGE_BATCH_LIMIT = 50;

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader, {
        vercelCronHeader: req.headers.get("x-vercel-cron"),
    });
    if (authError) return authError;

    const admin = createAdminClient();
    const now = new Date();

    const results = {
        trialsCharged: 0,
        activeCharged: 0,
        cardPaid: 0,
        notified: 0,
        blocked: 0,
        truncated: false,
        aiRecharge: { processed: 0, paid: 0, failed: 0 },
        errors: [] as string[],
    };

    /** H5.1: invoices já cobradas neste run — overdue loop não reprocessa (D0≠D1). */
    const processedInvoiceIds = new Set<string>();

    const { data: dueSubs, error: dueErr } = await admin
        .from("pagarme_subscriptions")
        .select(`
            id, company_id, plan, status, activated_at, next_billing_at, trial_ends_at,
            last_paid_at, updated_at, pagarme_customer_id, default_card_id, seat_quantity,
            companies ( id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj )
        `)
        .in("status", ["trial", "active"])
        .or(
            `and(status.eq.trial,trial_ends_at.lte.${now.toISOString()}),` +
                `and(status.eq.active,next_billing_at.lte.${now.toISOString()})`
        )
        .order("next_billing_at", { ascending: true, nullsFirst: true })
        .limit(CHARGE_BATCH_LIMIT + 1);

    if (dueErr) {
        console.error("[charge] Erro ao buscar subs vencidas:", dueErr.message);
        results.errors.push(`fetch_due_subs: ${dueErr.message}`);
    } else {
        const dueBatch = dueSubs ?? [];
        if (dueBatch.length > CHARGE_BATCH_LIMIT) {
            results.truncated = true;
        }
        for (const sub of dueBatch.slice(0, CHARGE_BATCH_LIMIT)) {
            try {
                if (sub.status === "trial") {
                    // BN-05: setup fee abolido — trial vencido gera a 1ª mensalidade
                    // (ou anual), amount canônico no banco via collectPayment.
                    const r = await collectPayment(admin, {
                        sub: sub as CollectSub,
                        kind: "subscription_first",
                        prefer: sub.default_card_id ? "card" : "pix",
                        attemptN: 0,
                        now,
                        fallbackSubStatus: "pending_payment",
                    });
                    if (r.ok && r.invoiceId) processedInvoiceIds.add(r.invoiceId);
                    if (r.ok && r.outcome === "paid_card") results.cardPaid++;
                    results.trialsCharged++;
                } else {
                    const neverPaid =
                        sub.last_paid_at == null ||
                        String(sub.last_paid_at).trim() === "";
                    const r = await collectPayment(admin, {
                        sub: sub as CollectSub,
                        kind: "subscription_renewal",
                        prefer: sub.default_card_id ? "card" : "pix",
                        attemptN: 0,
                        now,
                        // H5.2: neverPaid → pending_payment (não overdue)
                        fallbackSubStatus: neverPaid ? "pending_payment" : "overdue",
                    });
                    if (r.ok && r.invoiceId) processedInvoiceIds.add(r.invoiceId);
                    if (r.ok && r.outcome === "paid_card") results.cardPaid++;
                    results.activeCharged++;
                }
            } catch (err: unknown) {
                const msg = `sub ${sub.id}: ${err instanceof Error ? err.message : String(err)}`;
                console.error("[charge] Erro ao gerar cobrança:", msg);
                Sentry.captureException(err, {
                    tags: { companyId: sub.company_id, route: "billing-charge" },
                });
                results.errors.push(msg);
            }
        }
    }

    const { data: overdueInvoices, error: ovErr } = await admin
        .from("invoices")
        .select(`
            id, company_id, subscription_id, due_at, pagarme_payment_url, pix_qr_code,
            pagarme_subscriptions (
              id, status, company_id, plan, pagarme_customer_id, default_card_id, last_paid_at, updated_at, seat_quantity,
              companies ( id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj )
            ),
            companies ( whatsapp_phone, is_active )
        `)
        .eq("status", "pending")
        // BN-13: dunning/bloqueio só para obrigações de assinatura (mensal/anual).
        // seat_add / plan_upgrade / ai_pack são PIX avulsos — não entram no D7.
        .in("kind", ["subscription", "year"])
        .lte("due_at", now.toISOString())
        .order("due_at", { ascending: true })
        .limit(CHARGE_BATCH_LIMIT + 1);

    if (ovErr) {
        console.error("[charge] Erro ao buscar invoices vencidas:", ovErr.message);
        results.errors.push(`fetch_overdue_invoices: ${ovErr.message}`);
    } else {
        const invBatch = overdueInvoices ?? [];
        if (invBatch.length > CHARGE_BATCH_LIMIT) {
            results.truncated = true;
        }
        for (const inv of invBatch.slice(0, CHARGE_BATCH_LIMIT)) {
            if (processedInvoiceIds.has(inv.id)) continue;
            try {
                await processOverdueInvoiceRow(admin, inv, now, results);
            } catch (err: unknown) {
                const msg = `invoice ${inv.id}: ${err instanceof Error ? err.message : String(err)}`;
                console.error("[charge] Erro ao processar overdue:", msg);
                Sentry.captureException(err, {
                    tags: { companyId: inv.company_id, route: "billing-charge-overdue" },
                });
                results.errors.push(msg);
            }
        }
    }

    try {
        const aiResult = await processAiRechargeJobs(admin);
        results.aiRecharge = {
            processed: aiResult.processed,
            paid: aiResult.paid,
            failed: aiResult.failed,
        };
        results.errors.push(...aiResult.errors);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push(`ai_recharge: ${msg}`);
        Sentry.captureException(err, { tags: { route: "billing-charge-ai-recharge" } });
    }

    billingLog("charge_cron", "completed", {
        trialsCharged: results.trialsCharged,
        activeCharged: results.activeCharged,
        cardPaid: results.cardPaid,
        notified: results.notified,
        blocked: results.blocked,
        ai_recharge_paid: results.aiRecharge.paid,
        error_count: results.errors.length,
    });
    return NextResponse.json({ ok: true, ...results });
}

type OverdueInvoiceCompany = {
    whatsapp_phone?: string | null;
    is_active?: boolean | null;
};

async function processOverdueInvoiceRow(
    admin: ReturnType<typeof createAdminClient>,
    inv: {
        id: string;
        company_id: string;
        subscription_id: string;
        due_at: string;
        pagarme_payment_url: string | null;
        pix_qr_code: string | null;
        pagarme_subscriptions:
            | (CollectSub & { status?: string })
            | (CollectSub & { status?: string })[]
            | null;
        companies: OverdueInvoiceCompany | OverdueInvoiceCompany[] | null;
    },
    now: Date,
    results: { notified: number; blocked: number; cardPaid: number }
) {
    const subRaw = inv.pagarme_subscriptions;
    const sub = Array.isArray(subRaw) ? subRaw[0] ?? null : subRaw;
    const companyRaw = inv.companies;
    const company = Array.isArray(companyRaw) ? companyRaw[0] ?? null : companyRaw;

    if (!sub || sub.status === "blocked" || sub.status === "cancelled") return;

    const neverPaid = sub.last_paid_at == null || String(sub.last_paid_at).trim() === "";

    // BN-09/BN-13: never-paid NÃO entra no dunning de renovação nem é bloqueado no
    // D7. O ciclo de vida de quem nunca pagou (→ abandoned) é do cron mark-abandoned
    // (14d). Aqui só normaliza overdue órfão para pending_payment.
    if (neverPaid) {
        if (sub.status === "overdue") {
            await transitionBillingStatus(admin, {
                companyId: inv.company_id,
                to: "pending_payment",
                casUpdatedAt: sub.updated_at ?? null,
            });
        }
        return;
    }

    const dueAt = new Date(inv.due_at);
    const daysOverdue = Math.floor((now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000));

    const action = await resolveCollectionActionDb(admin, {
        daysOverdue,
        hasDefaultCard: Boolean(sub.default_card_id),
    });

    // D7: bloqueio só para renovação de quem JÁ pagou (last_paid_at presente).
    if (action.type === "block") {
        const blocked = await blockCompany(
            admin,
            inv.company_id,
            inv.subscription_id,
            sub.updated_at ?? null
        );
        if (blocked) results.blocked++;
        return;
    }

    if (action.type === "collect" && action.prefer === "card") {
        const r = await collectPayment(admin, {
            sub: {
                ...sub,
                companies: sub.companies ?? company,
            },
            kind: "subscription_renewal",
            prefer: "card",
            attemptN: Math.max(1, daysOverdue),
            now,
            fallbackSubStatus: "overdue",
            notifyWhatsApp: true,
        });
        if (r.ok && r.outcome === "paid_card") {
            results.cardPaid++;
            return;
        }
        results.notified++;
        return;
    }

    if (action.type === "notify_only" || action.type === "collect") {
        const day = action.type === "notify_only" ? action.day : daysOverdue === 0 ? 1 : daysOverdue;
        const msg = buildOverdueMessage(
            day,
            inv.pagarme_payment_url ?? inv.pix_qr_code ?? ""
        );
        if (msg && company?.whatsapp_phone) {
            const sent = await sendBillingNotification(inv.company_id, company.whatsapp_phone, msg);
            if (sent.ok) results.notified++;
        }
    }
}

async function blockCompany(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    subscriptionId: string,
    casUpdatedAt: string | null
): Promise<boolean> {
    const r = await transitionBillingStatus(admin, {
        companyId,
        to: "blocked",
        casUpdatedAt,
    });
    billingLog("charge_cron", "company_blocked", {
        company_id: companyId,
        subscription_id: subscriptionId,
        result: r.status,
        claimed: r.claimed,
        reason: r.reason,
    });
    return r.claimed || r.status === "already";
}
