/**
 * POST /api/billing/charge
 *
 * Cron diário (Vercel, 08:00 BRT) — vercel.json: "0 11 * * *" (UTC)
 *
 * 1. trial/active vencido → CollectPayment (card-first se default_card_id; senão PIX)
 * 2. overdue D1/D3 → retry card (CollectPayment) + WA; D5+ block
 * 3. pending_setup legado stale >5d → block
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import {
    createPixInvoiceOrder,
    getSetupPriceCents,
    centsToBRL,
    resolvePixFromOrder,
} from "@/lib/billing/pagarme";
import {
    sendBillingNotification,
    buildOverdueMessage,
} from "@/lib/billing/sendBillingNotification";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { billingLog } from "@/lib/billing/billingLog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import { collectPayment, type CollectSub } from "@/lib/billing/collectPayment";
import {
    resolveCollectionAction,
    resolveTrialDueKind,
} from "@/lib/billing/collectionPolicy";
import { processAiRechargeJobs } from "@/lib/billing/processAiRechargeJobs";

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

    const { data: dueSubs, error: dueErr } = await admin
        .from("pagarme_subscriptions")
        .select(`
            id, company_id, plan, status, activated_at, next_billing_at, trial_ends_at,
            last_paid_at, pagarme_customer_id, default_card_id,
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
                    const setupCents = getSetupPriceCents(String(sub.plan ?? "essencial"));
                    if (resolveTrialDueKind(setupCents) === "setup") {
                        await generateSetupCharge(admin, sub, now);
                    } else {
                        const r = await collectPayment(admin, {
                            sub: sub as CollectSub,
                            kind: "subscription_first",
                            prefer: sub.default_card_id ? "card" : "pix",
                            attemptN: 0,
                            now,
                            fallbackSubStatus: "pending_payment",
                        });
                        if (r.ok && r.outcome === "paid_card") results.cardPaid++;
                    }
                    results.trialsCharged++;
                } else {
                    const r = await collectPayment(admin, {
                        sub: sub as CollectSub,
                        kind: "subscription_renewal",
                        prefer: sub.default_card_id ? "card" : "pix",
                        attemptN: 0,
                        now,
                        fallbackSubStatus: "overdue",
                    });
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

    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const { data: overdueInvoices, error: ovErr } = await admin
        .from("invoices")
        .select(`
            id, company_id, subscription_id, due_at, pagarme_payment_url, pix_qr_code,
            pagarme_subscriptions (
              id, status, company_id, plan, pagarme_customer_id, default_card_id, last_paid_at,
              companies ( id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj )
            ),
            companies ( whatsapp_phone, is_active )
        `)
        .eq("status", "pending")
        .lte("due_at", now.toISOString())
        .order("due_at", { ascending: true })
        .limit(CHARGE_BATCH_LIMIT + 1);

    const { data: stalePendingSetups } = await admin
        .from("pagarme_subscriptions")
        .select("id, company_id")
        .in("status", ["pending_setup", "pending_payment"])
        .is("last_paid_at", null)
        .lte("updated_at", fiveDaysAgo.toISOString())
        .limit(CHARGE_BATCH_LIMIT);

    if (ovErr) {
        console.error("[charge] Erro ao buscar invoices vencidas:", ovErr.message);
        results.errors.push(`fetch_overdue_invoices: ${ovErr.message}`);
    } else {
        const invBatch = overdueInvoices ?? [];
        if (invBatch.length > CHARGE_BATCH_LIMIT) {
            results.truncated = true;
        }
        for (const inv of invBatch.slice(0, CHARGE_BATCH_LIMIT)) {
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

    for (const sub of stalePendingSetups ?? []) {
        try {
            await blockCompany(admin, sub.company_id, sub.id);
            results.blocked++;
        } catch (err: unknown) {
            results.errors.push(
                `pending_setup_block sub ${sub.id}: ${err instanceof Error ? err.message : String(err)}`
            );
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

type CompanyRow = {
    id?: string;
    name?: string | null;
    nome_fantasia?: string | null;
    email?: string | null;
    whatsapp_phone?: string | null;
    meta?: Record<string, unknown> | null;
    cnpj?: string | null;
};

function buildCustomerPayload(sub: { pagarme_customer_id?: string | null; company_id: string }, company: CompanyRow | null) {
    if (sub.pagarme_customer_id || !company) return undefined;
    return buildPagarmeCustomerPayload({
        id: sub.company_id,
        name: company.name ?? null,
        nome_fantasia: company.nome_fantasia ?? null,
        email: company.email ?? null,
        whatsapp_phone: company.whatsapp_phone ?? null,
        cnpj: company.cnpj ?? null,
        meta: company.meta ?? null,
    });
}

async function generateSetupCharge(
    admin: ReturnType<typeof createAdminClient>,
    sub: {
        id: string;
        company_id: string;
        plan: string | null;
        pagarme_customer_id: string | null;
        companies?: CompanyRow | CompanyRow[] | null;
    },
    _now: Date
) {
    const companyRaw = sub.companies;
    const company = Array.isArray(companyRaw) ? companyRaw[0] ?? null : companyRaw ?? null;
    const amountCents = getSetupPriceCents(String(sub.plan ?? "essencial"));
    const brlAmount = centsToBRL(amountCents);

    const { data: claimed, error: claimErr } = await admin
        .from("invoices")
        .insert({
            company_id: sub.company_id,
            subscription_id: sub.id,
            amount: brlAmount,
            status: "pending",
            due_at: _now.toISOString(),
            pagarme_order_id: null,
            pagarme_payment_url: "",
            pix_qr_code: null,
            kind: "setup",
        })
        .select("id")
        .single();

    if (claimErr) {
        if (isUniqueViolation(claimErr)) {
            console.log(`[charge] invoice de setup pendente já existe para sub ${sub.id}, pulando`);
            return;
        }
        throw new Error(claimErr.message);
    }

    const claimId = claimed.id as string;
    const compLabel = (company?.nome_fantasia ?? company?.name ?? "").trim() || "Renthus";

    try {
        const created = await createPixInvoiceOrder({
            amountCents,
            description: `Taxa de ativação Renthus — Plano ${sub.plan}`,
            itemCode: "setup",
            customerId: sub.pagarme_customer_id ?? undefined,
            customer: buildCustomerPayload(sub, company),
            additionalInfo: [
                { name: "Empresa", value: compLabel },
                { name: "Tipo", value: "Taxa de ativação" },
            ],
            metadata: {
                type: "setup",
                company_id: sub.company_id,
                subscription_id: sub.id,
                plan: String(sub.plan ?? ""),
            },
        });

        const { order, pixUrl, pixCode } = await resolvePixFromOrder(created);

        await admin
            .from("invoices")
            .update({
                pagarme_order_id: order.id,
                pagarme_payment_url: pixUrl ?? "",
                pix_qr_code: pixCode,
            })
            .eq("id", claimId);

        await admin
            .from("pagarme_subscriptions")
            .update({ status: "pending_payment" })
            .eq("id", sub.id);

        if (company?.whatsapp_phone) {
            const msg = buildOverdueMessage(1, pixUrl ?? pixCode ?? "");
            if (msg) await sendBillingNotification(sub.company_id, company.whatsapp_phone, msg);
        }
    } catch (err: unknown) {
        await admin.from("invoices").update({ status: "failed" }).eq("id", claimId);
        throw err;
    }
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

    const dueAt = new Date(inv.due_at);
    const daysOverdue = Math.floor((now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000));

    const action = resolveCollectionAction({
        daysOverdue,
        hasDefaultCard: Boolean(sub.default_card_id),
        hasPendingInvoice: true,
    });

    if (action.type === "block") {
        await blockCompany(admin, inv.company_id, inv.subscription_id);
        results.blocked++;
        return;
    }

    // B4.3: dunning WA/card retry só para quem já pagou ao menos uma vez
    if (neverPaid) return;

    if (action.type === "collect" && action.prefer === "card") {
        const r = await collectPayment(admin, {
            sub: {
                ...sub,
                companies: sub.companies ?? company,
            },
            kind: "subscription_renewal",
            prefer: "card",
            attemptN: action.attemptLabel === "d1" ? 1 : 3,
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
    subscriptionId: string
) {
    await Promise.all([
        admin.from("pagarme_subscriptions").update({ status: "blocked" }).eq("id", subscriptionId),
        admin.from("companies").update({ is_active: false }).eq("id", companyId),
        admin
            .from("pagarme_subscriptions")
            .update({ status: "blocked", updated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .in("status", ["active", "trial"]),
    ]);

    billingLog("charge_cron", "company_blocked", {
        company_id: companyId,
        subscription_id: subscriptionId,
    });
}
