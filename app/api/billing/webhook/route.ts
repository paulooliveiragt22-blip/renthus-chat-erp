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

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/billing/pagarme";
import { activateTrial }          from "@/app/api/billing/signup/route";

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
            // Obtém pagarme_customer_id do order
            const pagarmeCustomerId: string = order?.customer?.id ?? "";

            await activateTrial(admin, companyId, sp.plan as "bot" | "complete", pagarmeCustomerId);
            console.log(`[webhook/pagarme] Trial ativado para empresa ${companyId}`);
        }

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
            .select("id, activated_at")
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
