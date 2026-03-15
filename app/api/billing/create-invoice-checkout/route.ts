/**
 * POST /api/billing/create-invoice-checkout
 *
 * Cria um checkout hosted no Pagar.me para a fatura pendente da empresa.
 * Chamado pela página /billing/blocked quando o usuário clica em "Pagar mensalidade".
 *
 * Body: { company_id?: string }  (usa cookie renthus_company_id como fallback)
 *
 * Retorna: { checkout_url }
 */

import { NextResponse }      from "next/server";
import { cookies }            from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createCheckoutOrder,
    extractCheckoutUrl,
    getMonthlyPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";

export const runtime = "nodejs";

const SUCCESS_URL =
    process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/billing/checkout-success`
        : "https://app.renthus.com.br/billing/checkout-success";

export async function POST(req: Request) {
    try {
        const body        = await req.json().catch(() => ({})) as { company_id?: string };
        const cookieStore = await cookies();
        const companyId   = body.company_id ?? cookieStore.get("renthus_company_id")?.value;

        if (!companyId) {
            return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 });
        }

        const admin = createAdminClient();

        // Busca a subscription para saber o plano
        const { data: sub } = await admin
            .from("pagarme_subscriptions")
            .select("id, plan, status, pagarme_customer_id")
            .eq("company_id", companyId)
            .maybeSingle();

        if (!sub) {
            return NextResponse.json({ error: "Assinatura não encontrada" }, { status: 404 });
        }

        // Busca a invoice pendente mais recente
        const { data: inv } = await admin
            .from("invoices")
            .select("id, amount, pagarme_order_id, pagarme_payment_url")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        // Se já existe link de checkout válido, retorna sem criar novo
        if (inv?.pagarme_payment_url && inv.pagarme_payment_url.includes("checkout.pagar.me")) {
            return NextResponse.json({ ok: true, checkout_url: inv.pagarme_payment_url });
        }

        // Busca dados da empresa para o customer
        const { data: company } = await admin
            .from("companies")
            .select("name, email, whatsapp_phone, meta")
            .eq("id", companyId)
            .maybeSingle();

        const amountCents = inv?.amount
            ? Math.round(inv.amount * 100)
            : getMonthlyPriceCents(sub.plan as "bot" | "complete");

        const cnpj: string = (company?.meta as any)?.cnpj?.replace(/\D/g, "") ?? "";

        // Cria checkout order no Pagar.me (PIX + cartão, sem parcelamento para mensalidade)
        const order = await createCheckoutOrder({
            amountCents,
            description:     `Mensalidade Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
            code:            "mensalidade",
            maxInstallments: 1, // mensalidade: à vista
            acceptPix:       true,
            customerId:      sub.pagarme_customer_id ?? undefined,
            customer:        !sub.pagarme_customer_id && company
                ? {
                      name:     company.name,
                      email:    company.email ?? `${companyId}@renthus.com.br`,
                      document: cnpj || undefined,
                      phone:    company.whatsapp_phone ?? undefined,
                  }
                : undefined,
            successUrl: SUCCESS_URL,
            metadata: {
                type:            "invoice",
                company_id:      companyId,
                subscription_id: sub.id,
                invoice_id:      inv?.id ?? "",
                plan:            sub.plan,
            },
        });

        const checkoutUrl = extractCheckoutUrl(order);

        if (!checkoutUrl) {
            return NextResponse.json(
                { error: "Erro ao gerar link de pagamento" },
                { status: 500 }
            );
        }

        // Atualiza invoice com o novo link (ou cria se não existia)
        if (inv) {
            await admin
                .from("invoices")
                .update({
                    pagarme_order_id:    order.id,
                    pagarme_payment_url: checkoutUrl,
                })
                .eq("id", inv.id);
        } else {
            // Cria invoice on-demand se não existia (empresa bloqueada sem invoice)
            await admin.from("invoices").insert({
                company_id:          companyId,
                subscription_id:     sub.id,
                amount:              centsToBRL(amountCents),
                status:              "pending",
                due_at:              new Date().toISOString(),
                pagarme_order_id:    order.id,
                pagarme_payment_url: checkoutUrl,
            });
        }

        return NextResponse.json({ ok: true, checkout_url: checkoutUrl });

    } catch (err: any) {
        console.error("[create-invoice-checkout] Erro:", err?.message ?? err);
        return NextResponse.json(
            { error: err?.message ?? "Erro interno" },
            { status: 500 }
        );
    }
}
