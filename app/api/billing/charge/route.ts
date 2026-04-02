/**
 * POST /api/billing/charge
 *
 * Cron diário (Vercel, 08:00 BRT) — vercel.json: "0 11 * * *" (UTC)
 *
 * Responsabilidades:
 *  1. trial vencido       → gera primeira invoice (PIX) + status='overdue'
 *  2. active vencido      → gera nova invoice (PIX)    + status='overdue'
 *  3. overdue dias 1,3,5  → envia aviso WhatsApp
 *  4. overdue > 5 dias    → bloqueia empresa (companies.is_active=false) + status='blocked'
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    getMonthlyPriceCents,
    centsToBRL,
    extractPixUrl,
    extractPixCode,
} from "@/lib/billing/pagarme";
import {
    sendBillingNotification,
    buildOverdueMessage,
} from "@/lib/billing/sendBillingNotification";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { billingLog } from "@/lib/billing/billingLog";

export const runtime = "nodejs";

export async function POST(req: Request) {
    // Verifica CRON_SECRET (Vercel envia automaticamente quando configurado)
    const authHeader = (req as any).headers?.get?.("authorization") ?? "";
    const cronSecret = process.env.CRON_SECRET ?? "";

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const now   = new Date();

    const results = {
        trialsCharged:   0,
        activeCharged:   0,
        notified:        0,
        blocked:         0,
        errors:          [] as string[],
    };

    // -----------------------------------------------------------------------
    // 1 & 2. Trials e ativas vencidas → gerar invoice
    // -----------------------------------------------------------------------
    const { data: dueSubs, error: dueErr } = await admin
        .from("pagarme_subscriptions")
        .select(`
            id, company_id, plan, status, activated_at, next_billing_at, trial_ends_at,
            pagarme_customer_id,
            companies ( id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj )
        `)
        .in("status", ["trial", "active"])
        .or(
            `and(status.eq.trial,trial_ends_at.lte.${now.toISOString()}),` +
            `and(status.eq.active,next_billing_at.lte.${now.toISOString()})`
        );

    if (dueErr) {
        console.error("[charge] Erro ao buscar subs vencidas:", dueErr.message);
        results.errors.push(`fetch_due_subs: ${dueErr.message}`);
    } else {
        for (const sub of dueSubs ?? []) {
            try {
                await generateInvoice(admin, sub, now);

                if (sub.status === "trial") results.trialsCharged++;
                else results.activeCharged++;
            } catch (err: any) {
                const msg = `sub ${sub.id}: ${err?.message ?? String(err)}`;
                console.error("[charge] Erro ao gerar invoice:", msg);
                results.errors.push(msg);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 3 & 4. Overdues — notificar (dias 1, 3, 5) e bloquear (> 5 dias)
    // -----------------------------------------------------------------------
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const { data: overdueInvoices, error: ovErr } = await admin
        .from("invoices")
        .select(`
            id, company_id, subscription_id, due_at, pagarme_payment_url, pix_qr_code,
            pagarme_subscriptions ( id, status ),
            companies ( whatsapp_phone, is_active )
        `)
        .eq("status", "pending")
        .lte("due_at", now.toISOString());

    if (ovErr) {
        console.error("[charge] Erro ao buscar invoices vencidas:", ovErr.message);
        results.errors.push(`fetch_overdue_invoices: ${ovErr.message}`);
    } else {
        for (const inv of overdueInvoices ?? []) {
            try {
                const sub     = (inv as any).pagarme_subscriptions;
                const company = (inv as any).companies;

                if (!sub || sub.status === "blocked" || sub.status === "cancelled") continue;

                const dueAt      = new Date(inv.due_at);
                const daysOverdue = Math.floor(
                    (now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000)
                );

                // Bloquear após 5 dias
                if (daysOverdue >= 5) {
                    await blockCompany(admin, inv.company_id, inv.subscription_id);
                    results.blocked++;
                    continue;
                }

                // Enviar aviso nos dias 1, 3 e 5
                const msg = buildOverdueMessage(
                    daysOverdue === 0 ? 1 : daysOverdue,
                    inv.pagarme_payment_url ?? inv.pix_qr_code ?? ""
                );

                if (msg && company?.whatsapp_phone) {
                    const sent = await sendBillingNotification(company.whatsapp_phone, msg);
                    if (sent.ok) results.notified++;
                }
            } catch (err: any) {
                const msg = `invoice ${inv.id}: ${err?.message ?? String(err)}`;
                console.error("[charge] Erro ao processar overdue:", msg);
                results.errors.push(msg);
            }
        }
    }

    billingLog("charge_cron", "completed", {
        trialsCharged: results.trialsCharged,
        activeCharged: results.activeCharged,
        notified:      results.notified,
        blocked:       results.blocked,
        error_count:   results.errors.length,
    });
    return NextResponse.json({ ok: true, ...results });
}

// ---------------------------------------------------------------------------
// generateInvoice: cria order PIX no Pagar.me + registro no banco
// ---------------------------------------------------------------------------
async function generateInvoice(
    admin: ReturnType<typeof createAdminClient>,
    sub: any,
    now: Date
) {
    const company     = sub.companies as {
        id?: string;
        name?: string | null;
        nome_fantasia?: string | null;
        email?: string | null;
        whatsapp_phone?: string | null;
        meta?: Record<string, unknown> | null;
        cnpj?: string | null;
    } | null;
    const amountCents = getMonthlyPriceCents(sub.plan as "bot" | "complete");

    const customerPayload =
        !sub.pagarme_customer_id && company
            ? buildPagarmeCustomerPayload({
                  id:             sub.company_id,
                  name:           company.name ?? null,
                  nome_fantasia:  company.nome_fantasia ?? null,
                  email:          company.email ?? null,
                  whatsapp_phone: company.whatsapp_phone ?? null,
                  cnpj:           company.cnpj ?? null,
                  meta:           company.meta ?? null,
              })
            : undefined;

    const order = await createPixInvoiceOrder({
        amountCents,
        description: `Mensalidade Renthus — Plano ${sub.plan}`,
        customerId:  sub.pagarme_customer_id ?? undefined,
        customer:    customerPayload,
        metadata: {
            type:            "invoice",
            company_id:      sub.company_id,
            subscription_id: sub.id,
            plan:            sub.plan,
        },
    });

    const pixUrl  = extractPixUrl(order);
    const pixCode = extractPixCode(order);

    // Registra invoice
    await admin.from("invoices").insert({
        company_id:          sub.company_id,
        subscription_id:     sub.id,
        amount:              centsToBRL(amountCents),
        status:              "pending",
        due_at:              now.toISOString(),
        pagarme_order_id:    order.id,
        pagarme_payment_url: pixUrl,
        pix_qr_code:         pixCode,
    });

    // Atualiza subscription para 'overdue'
    await admin
        .from("pagarme_subscriptions")
        .update({ status: "overdue" })
        .eq("id", sub.id);

    // Envia primeiro aviso imediato (dia 0 = dia do vencimento)
    if (company?.whatsapp_phone) {
        const msg = buildOverdueMessage(1, pixUrl ?? pixCode ?? "");
        if (msg) {
            await sendBillingNotification(company.whatsapp_phone, msg);
        }
    }
}

// ---------------------------------------------------------------------------
// blockCompany: bloqueia empresa e para o bot
// ---------------------------------------------------------------------------
async function blockCompany(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    subscriptionId: string
) {
    await Promise.all([
        admin
            .from("pagarme_subscriptions")
            .update({ status: "blocked" })
            .eq("id", subscriptionId),

        admin
            .from("companies")
            .update({ is_active: false })
            .eq("id", companyId),
    ]);

    billingLog("charge_cron", "company_blocked", { company_id: companyId, subscription_id: subscriptionId });
}
