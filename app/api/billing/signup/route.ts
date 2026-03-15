/**
 * POST /api/billing/signup
 *
 * Processa o pagamento do setup e cria a assinatura trial.
 *
 * Body: {
 *   company_id: string
 *   plan: 'bot' | 'complete'
 *   installments: number (1–10)
 *   card_token: string  — token do cartão gerado pelo Pagar.me.js
 * }
 *
 * Retorna: { success, subscription_id?, pagarme_order_id, order_status }
 *
 * Se o pagamento for aprovado imediatamente, a subscription já é criada
 * com status='trial'. Caso contrário, aguarda o webhook order.paid.
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createCustomer,
    createSetupOrder,
    getSetupPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { activateTrial } from "@/lib/billing/activateTrial";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            company_id?:   string;
            plan?:         string;
            installments?: number;
            card_token?:   string;
        };

        const { company_id, plan, card_token } = body;
        const installments = Math.min(10, Math.max(1, body.installments ?? 1));

        if (!company_id || !plan || !card_token) {
            return NextResponse.json(
                { error: "company_id, plan e card_token são obrigatórios" },
                { status: 400 }
            );
        }

        if (!["bot", "complete"].includes(plan)) {
            return NextResponse.json(
                { error: "Plano inválido. Use 'bot' ou 'complete'" },
                { status: 400 }
            );
        }

        const admin = createAdminClient();

        // 1. Verifica se a empresa já tem assinatura ativa
        const { data: existing } = await admin
            .from("pagarme_subscriptions")
            .select("id, status")
            .eq("company_id", company_id)
            .maybeSingle();

        if (existing && ["trial", "active", "overdue"].includes(existing.status)) {
            return NextResponse.json(
                { error: "Empresa já possui assinatura ativa" },
                { status: 409 }
            );
        }

        // 2. Busca dados da empresa
        const { data: company, error: compErr } = await admin
            .from("companies")
            .select("id, name, email, whatsapp_phone, meta")
            .eq("id", company_id)
            .maybeSingle();

        if (compErr || !company) {
            return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
        }

        const cnpj: string | undefined = (company.meta as any)?.cnpj?.replace(/\D/g, "");

        // 3. Cria ou reutiliza customer no Pagar.me
        let pagarmeCustomerId: string | undefined;

        const { data: existingSub } = await admin
            .from("pagarme_subscriptions")
            .select("pagarme_customer_id")
            .eq("company_id", company_id)
            .maybeSingle();

        if (existingSub?.pagarme_customer_id) {
            pagarmeCustomerId = existingSub.pagarme_customer_id;
        } else {
            const customer = await createCustomer({
                name:     company.name,
                email:    company.email ?? `${company_id}@renthus.com.br`,
                document: cnpj,
                phone:    company.whatsapp_phone ?? undefined,
            });
            pagarmeCustomerId = customer.id;
        }

        // 4. Cria order de setup no Pagar.me
        const amountCents = getSetupPriceCents(plan as "bot" | "complete");

        const order = await createSetupOrder({
            amountCents,
            description: `Setup Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)} — Renthus`,
            installments,
            cardToken:   card_token,
            customerId:  pagarmeCustomerId,
            metadata: {
                type:       "setup",
                company_id,
                plan,
            },
        });

        // 5. Registra setup_payment no banco
        const { error: spErr } = await admin
            .from("setup_payments")
            .insert({
                company_id,
                plan,
                amount:           centsToBRL(amountCents),
                installments,
                status:           order.status === "paid" ? "paid" : "pending",
                paid_at:          order.status === "paid" ? new Date().toISOString() : null,
                pagarme_order_id: order.id,
            });

        if (spErr) {
            console.error("[signup] Erro ao salvar setup_payment:", spErr.message);
        }

        // 6. Se aprovado imediatamente, ativa o trial
        let subscriptionId: string | undefined;

        if (order.status === "paid") {
            subscriptionId = await activateTrial(
                admin,
                company_id,
                plan as "bot" | "complete",
                pagarmeCustomerId ?? ""
            );
        }

        return NextResponse.json({
            success:          order.status === "paid",
            order_status:     order.status,
            pagarme_order_id: order.id,
            subscription_id:  subscriptionId,
            message:
                order.status === "paid"
                    ? "Pagamento aprovado! Trial de 30 dias ativado."
                    : "Pagamento em processamento. Aguarde a confirmação.",
        });
    } catch (err: any) {
        console.error("[signup] Erro:", err?.message ?? err);
        return NextResponse.json(
            { error: err?.message ?? "Erro interno" },
            { status: 500 }
        );
    }
}
