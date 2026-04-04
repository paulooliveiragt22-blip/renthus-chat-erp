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
    getSetupPriceCents,
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
    // 1 & 2. Trials vencidos → setup_payment | Ativas vencidas → invoice
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
                if (sub.status === "trial") {
                    await generateSetupCharge(admin, sub, now);
                    results.trialsCharged++;
                } else {
                    await generateMonthlyInvoice(admin, sub, now);
                    results.activeCharged++;
                }
            } catch (err: any) {
                const msg = `sub ${sub.id}: ${err?.message ?? String(err)}`;
                console.error("[charge] Erro ao gerar cobrança:", msg);
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

    // Pending_setup com mais de 5 dias sem pagamento → bloquear
    const { data: stalePendingSetups } = await admin
        .from("pagarme_subscriptions")
        .select("id, company_id")
        .eq("status", "pending_setup")
        .lte("updated_at", fiveDaysAgo.toISOString());

    if (ovErr) {
        console.error("[charge] Erro ao buscar invoices vencidas:", ovErr.message);
        results.errors.push(`fetch_overdue_invoices: ${ovErr.message}`);
    } else {
        for (const inv of overdueInvoices ?? []) {
            try {
                await processOverdueInvoiceRow(admin, inv, now, results);
            } catch (err: any) {
                const msg = `invoice ${inv.id}: ${err?.message ?? String(err)}`;
                console.error("[charge] Erro ao processar overdue:", msg);
                results.errors.push(msg);
            }
        }
    }

    // Bloquear pending_setup antigos (>5 dias sem pagar o setup)
    for (const sub of stalePendingSetups ?? []) {
        try {
            await blockCompany(admin, sub.company_id, sub.id);
            results.blocked++;
        } catch (err: any) {
            results.errors.push(`pending_setup_block sub ${sub.id}: ${err?.message ?? String(err)}`);
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
// Helpers
// ---------------------------------------------------------------------------

type CompanyRow = {
    id?: string;
    name?: string | null;
    nome_fantasia?: string | null;
    email?: string | null;
    whatsapp_phone?: string | null;
    meta?: Record<string, unknown> | null;
    cnpj?: string | null;
};

function buildCustomerPayload(sub: any, company: CompanyRow | null) {
    if (sub.pagarme_customer_id || !company) return undefined;
    return buildPagarmeCustomerPayload({
        id:             sub.company_id,
        name:           company.name ?? null,
        nome_fantasia:  company.nome_fantasia ?? null,
        email:          company.email ?? null,
        whatsapp_phone: company.whatsapp_phone ?? null,
        cnpj:           company.cnpj ?? null,
        meta:           company.meta ?? null,
    });
}

// ---------------------------------------------------------------------------
// generateSetupCharge: trial vencido → primeira cobrança é o setup fee
// ---------------------------------------------------------------------------
async function generateSetupCharge(
    admin: ReturnType<typeof createAdminClient>,
    sub: any,
    now: Date
) {
    // Dedup: não criar se já existe setup_payment pendente para esta subscription
    const { data: existing } = await admin
        .from("setup_payments")
        .select("id")
        .eq("company_id", sub.company_id)
        .eq("status", "pending")
        .maybeSingle();

    if (existing) {
        console.log(`[charge] setup_payment pendente já existe para sub ${sub.id}, pulando`);
        return;
    }

    const company     = sub.companies as CompanyRow | null;
    const amountCents = getSetupPriceCents(sub.plan as "bot" | "complete");
    const compLabel   = (company?.nome_fantasia ?? company?.name ?? "").trim() || "Renthus";

    const order = await createPixInvoiceOrder({
        amountCents,
        description: `Taxa de ativação Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
        itemCode:    "setup",
        customerId:  sub.pagarme_customer_id ?? undefined,
        customer:    buildCustomerPayload(sub, company),
        additionalInfo: [
            { name: "Empresa", value: compLabel },
            { name: "Tipo",    value: "Taxa de ativação" },
        ],
        metadata: {
            type:            "setup",
            company_id:      sub.company_id,
            subscription_id: sub.id,
            plan:            sub.plan,
        },
    });

    const pixUrl  = extractPixUrl(order);
    const pixCode = extractPixCode(order);

    await admin.from("setup_payments").insert({
        company_id:          sub.company_id,
        plan:                sub.plan,
        amount:              centsToBRL(amountCents),
        installments:        1,
        status:              "pending",
        pagarme_order_id:    order.id,
        pagarme_payment_url: pixUrl ?? "",
    });

    await admin
        .from("pagarme_subscriptions")
        .update({ status: "pending_setup" })
        .eq("id", sub.id);

    if (company?.whatsapp_phone) {
        const msg = buildOverdueMessage(1, pixUrl ?? pixCode ?? "");
        if (msg) await sendBillingNotification(company.whatsapp_phone, msg);
    }
}

// ---------------------------------------------------------------------------
// generateMonthlyInvoice: ativa com next_billing_at vencido → mensalidade
// ---------------------------------------------------------------------------
async function generateMonthlyInvoice(
    admin: ReturnType<typeof createAdminClient>,
    sub: any,
    now: Date
) {
    // Dedup: não criar se já existe invoice pendente para esta subscription
    const { data: existing } = await admin
        .from("invoices")
        .select("id")
        .eq("subscription_id", sub.id)
        .eq("status", "pending")
        .maybeSingle();

    if (existing) {
        console.log(`[charge] invoice pendente já existe para sub ${sub.id}, pulando`);
        return;
    }

    const company     = sub.companies as CompanyRow | null;
    const amountCents = getMonthlyPriceCents(sub.plan as "bot" | "complete");
    const compLabel   = (company?.nome_fantasia ?? company?.name ?? "").trim() || "Renthus";

    const order = await createPixInvoiceOrder({
        amountCents,
        description: `Mensalidade Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
        customerId:  sub.pagarme_customer_id ?? undefined,
        customer:    buildCustomerPayload(sub, company),
        additionalInfo: [
            { name: "Empresa", value: compLabel },
            { name: "Tipo",    value: "Mensalidade" },
        ],
        metadata: {
            type:            "invoice",
            company_id:      sub.company_id,
            subscription_id: sub.id,
            plan:            sub.plan,
        },
    });

    const pixUrl  = extractPixUrl(order);
    const pixCode = extractPixCode(order);

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

    await admin
        .from("pagarme_subscriptions")
        .update({ status: "overdue" })
        .eq("id", sub.id);

    if (company?.whatsapp_phone) {
        const msg = buildOverdueMessage(1, pixUrl ?? pixCode ?? "");
        if (msg) await sendBillingNotification(company.whatsapp_phone, msg);
    }
}

async function processOverdueInvoiceRow(
    admin: ReturnType<typeof createAdminClient>,
    inv: any,
    now: Date,
    results: { notified: number; blocked: number }
) {
    const sub     = inv.pagarme_subscriptions;
    const company = inv.companies;

    if (!sub || sub.status === "blocked" || sub.status === "cancelled") return;

    const dueAt       = new Date(inv.due_at);
    const daysOverdue = Math.floor(
        (now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (daysOverdue >= 5) {
        await blockCompany(admin, inv.company_id, inv.subscription_id);
        results.blocked++;
        return;
    }

    const msg = buildOverdueMessage(
        daysOverdue === 0 ? 1 : daysOverdue,
        inv.pagarme_payment_url ?? inv.pix_qr_code ?? ""
    );

    if (msg && company?.whatsapp_phone) {
        const sent = await sendBillingNotification(company.whatsapp_phone, msg);
        if (sent.ok) results.notified++;
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
