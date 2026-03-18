/**
 * POST /api/billing/webhook
 *
 * Webhook do Pagar.me — recebe eventos de pagamento.
 *
 * Eventos tratados:
 *   order.paid          → se setup_payment: ativa trial
 *                       → se invoice:       marca paga + ativa/reativa subscription
 *   order.payment_failed → registra falha
 *
 * Variáveis de ambiente:
 *   PAGARME_WEBHOOK_SECRET — segredo configurado no painel Pagar.me (opcional em dev)
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/billing/pagarme";
import { activateTrial } from "@/lib/billing/activateTrial";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";

export const runtime = "nodejs";

// Pagar.me não envia autenticação de rota — usa assinatura HMAC no body
export async function POST(req: Request) {
    const rawBody  = await req.text();
    const signature = (req as any).headers?.get?.("x-hub-signature") ?? "";

    // Verifica assinatura (ignora em dev se PAGARME_WEBHOOK_SECRET não estiver setado)
    const valid = await verifyWebhookSignature(rawBody, signature.replace("sha256=", ""));
    if (!valid) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const eventType: string = event?.type ?? "";
    const data              = event?.data ?? {};

    console.log(`[webhook/pagarme] Evento: ${eventType} | Order: ${data?.id}`);

    const admin = createAdminClient();

    try {
        switch (eventType) {
            case "order.paid":
                await handleOrderPaid(admin, data);
                break;

            case "order.payment_failed":
            case "charge.failed":
                await handleOrderFailed(admin, data);
                break;

            default:
                console.log(`[webhook/pagarme] Evento ignorado: ${eventType}`);
        }
    } catch (err: any) {
        console.error("[webhook/pagarme] Erro:", err?.message ?? err);
        // Retorna 200 para o Pagar.me não fazer retry em erros de negócio
        return NextResponse.json({ ok: false, error: err?.message ?? "Erro interno" });
    }

    return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId  = order?.id as string;
    const metadata = order?.metadata ?? {};
    const type     = metadata?.type as string;
    const companyId = metadata?.company_id as string;

    if (!orderId || !companyId) {
        console.warn("[webhook/pagarme] order.paid sem orderId ou company_id");
        return;
    }

    if (type === "setup") {
        // ── Setup pago: ativa trial ──────────────────────────────────────
        const { data: sp } = await admin
            .from("setup_payments")
            .select("id, plan")
            .eq("pagarme_order_id", orderId)
            .maybeSingle();

        if (!sp) {
            console.warn("[webhook/pagarme] setup_payment não encontrado para order:", orderId);
            return;
        }

        // Atualiza setup_payment
        await admin
            .from("setup_payments")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("id", sp.id);

        // Ativa trial (se ainda não ativado)
        const { data: existingSub } = await admin
            .from("pagarme_subscriptions")
            .select("id, status")
            .eq("company_id", companyId)
            .maybeSingle();

        if (!existingSub || existingSub.status === "cancelled") {
            const pagarmeCustomerId: string = order?.customer?.id ?? "";
            await activateTrial(
                admin,
                companyId,
                sp.plan as "bot" | "complete",
                pagarmeCustomerId
            );
            console.log(
                `[webhook/pagarme] Trial ativado para empresa ${companyId} (plano ${sp.plan})`
            );
        }

        // Garante subscription lógica (plans/subscriptions) alinhada com o plano bot/complete
        await syncLogicalSubscription(admin, companyId, sp.plan as string);

        // Cria usuário no Supabase Auth e envia notificações de boas-vindas
        await provisionUserAfterPayment(admin, companyId, sp.plan as string);

    } else if (type === "invoice") {
        // ── Invoice paga: atualiza subscription ─────────────────────────
        const subscriptionId = metadata?.subscription_id as string;

        // Marca invoice como paga
        const { data: inv } = await admin
            .from("invoices")
            .select("id, subscription_id")
            .eq("pagarme_order_id", orderId)
            .maybeSingle();

        if (!inv) {
            console.warn("[webhook/pagarme] invoice não encontrada para order:", orderId);
            return;
        }

        const paidAt = new Date();

        await admin
            .from("invoices")
            .update({ status: "paid", paid_at: paidAt.toISOString() })
            .eq("id", inv.id);

        // Calcula próximo aniversário de cobrança
        const { data: sub } = await admin
            .from("pagarme_subscriptions")
            .select("id, activated_at, plan")
            .eq("id", inv.subscription_id)
            .maybeSingle();

        const nextBillingAt = sub?.activated_at
            ? nextBillingDate(new Date(sub.activated_at), paidAt)
            : new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Atualiza subscription
        await admin
            .from("pagarme_subscriptions")
            .update({
                status:         "active",
                last_paid_at:   paidAt.toISOString(),
                next_billing_at: nextBillingAt.toISOString(),
            })
            .eq("id", inv.subscription_id);

        // Reativa empresa (caso estivesse bloqueada)
        await admin
            .from("companies")
            .update({ is_active: true })
            .eq("id", companyId);

        // Garante subscription lógica ativa para o plano atual
        if (sub?.plan) {
            await syncLogicalSubscription(admin, companyId, sub.plan as string);
        }

        console.log(
            `[webhook/pagarme] Invoice ${inv.id} paga. ` +
            `Próxima cobrança: ${nextBillingAt.toISOString()}`
        );
    }
}

async function handleOrderFailed(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId = order?.id as string;
    if (!orderId) return;

    // Atualiza invoice com status failed (se encontrada)
    await admin
        .from("invoices")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    // Atualiza setup_payment (se for setup)
    await admin
        .from("setup_payments")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    console.log(`[webhook/pagarme] Pagamento falhou para order: ${orderId}`);
}

// ---------------------------------------------------------------------------
// Sincroniza tabela subscriptions (entitlements) com pagarme_subscriptions
// ---------------------------------------------------------------------------

async function syncLogicalSubscription(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    planKey: string
) {
    if (!companyId || !planKey) return;

    // Apenas nossos dois planos principais por enquanto
    if (planKey !== "bot" && planKey !== "complete") return;

    const { data: planRow, error: planErr } = await admin
        .from("plans")
        .select("id")
        .eq("key", planKey)
        .maybeSingle();

    if (planErr || !planRow?.id) {
        console.warn(
            "[billing/webhook] syncLogicalSubscription: plano não encontrado para key=",
            planKey,
            "| err=",
            planErr?.message
        );
        return;
    }

    await admin.from("subscriptions").upsert(
        {
            company_id: companyId,
            plan_id: planRow.id,
            status: "active",
            started_at: new Date().toISOString(),
        },
        { onConflict: "company_id" }
    );
}

// ---------------------------------------------------------------------------
// Provisiona usuário no Supabase Auth após pagamento do setup
// ---------------------------------------------------------------------------

async function provisionUserAfterPayment(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: string
) {
    // Lê dados da empresa
    const { data: company } = await admin
        .from("companies")
        .select("email, name, onboarding_token, whatsapp_phone")
        .eq("id", companyId)
        .maybeSingle();

    if (!company?.email) {
        console.warn("[webhook/pagarme] Empresa sem email, pulando provisionamento:", companyId);
        return;
    }

    // Senha temporária aleatória (será trocada no /signup/complete)
    const tempPassword =
        Math.random().toString(36).slice(-8) +
        Math.random().toString(36).slice(-4).toUpperCase() +
        "1!";

    // Cria usuário no Auth (ignora se já existir)
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email:         company.email,
        password:      tempPassword,
        email_confirm: false,
        user_metadata: { company_id: companyId, company_name: company.name },
    });

    if (authErr) {
        // Usuário já existe — não é um erro crítico
        console.warn("[webhook/pagarme] createUser:", authErr.message);
    } else if (authData?.user?.id) {
        // Vincula usuário à empresa como owner
        await admin
            .from("company_users")
            .upsert(
                { company_id: companyId, user_id: authData.user.id, role: "owner" },
                { onConflict: "company_id,user_id" }
            );
        console.log(`[webhook/pagarme] Auth user criado para ${company.email}`);
    }

    // URL de onboarding para o cliente completar o cadastro
    const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.renthus.com.br";
    const onboardUrl  = `${appUrl}/signup/complete?token=${company.onboarding_token}`;

    // Notifica Renthus via WhatsApp
    const renthusNumber = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";
    await sendBillingNotification(
        renthusNumber,
        `🎉 *Novo cliente!*\n\n` +
        `Empresa: ${company.name}\n` +
        `Email: ${company.email}\n` +
        `Plano: ${plan}\n` +
        `WhatsApp: ${company.whatsapp_phone ?? "-"}\n\n` +
        `Link onboarding: ${onboardUrl}`
    );
}

// ---------------------------------------------------------------------------
// Calcula próximo aniversário de cobrança a partir da data de ativação
// ---------------------------------------------------------------------------
function nextBillingDate(activatedAt: Date, referenceDate: Date): Date {
    const next = new Date(activatedAt);
    next.setMonth(referenceDate.getMonth());
    next.setFullYear(referenceDate.getFullYear());

    if (next <= referenceDate) {
        next.setMonth(next.getMonth() + 1);
    }

    return next;
}
