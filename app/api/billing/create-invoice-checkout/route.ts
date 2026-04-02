/**
 * POST /api/billing/create-invoice-checkout
 *
 * Devolve PIX da fatura pendente (API Pagar.me — sem checkout hospedado / reCAPTCHA).
 * Chamado pela página /billing/blocked ao clicar em "Pagar mensalidade".
 *
 * Body: { company_id?: string }  (usa cookie renthus_company_id como fallback)
 *
 * Retorna: { ok, pix_qr_url?, pix_qr_code? }
 */

import { NextResponse }      from "next/server";
import { cookies }            from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    extractPixCode,
    extractPixUrl,
    getMonthlyPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body        = await req.json().catch(() => ({})) as { company_id?: string };
        const cookieStore = await cookies();
        const companyId   = body.company_id ?? cookieStore.get("renthus_company_id")?.value;

        if (!companyId) {
            return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 });
        }

        const admin = createAdminClient();

        const { data: sub } = await admin
            .from("pagarme_subscriptions")
            .select("id, plan, status, pagarme_customer_id")
            .eq("company_id", companyId)
            .maybeSingle();

        if (!sub) {
            return NextResponse.json({ error: "Assinatura não encontrada" }, { status: 404 });
        }

        const { data: inv } = await admin
            .from("invoices")
            .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const hasHostedCheckout =
            inv?.pagarme_payment_url?.includes("checkout.pagar.me") ?? false;

        // Já temos PIX da cobrança (cron / geração anterior) — reutiliza
        if (inv?.pagarme_order_id && inv.pagarme_payment_url && !hasHostedCheckout) {
            return NextResponse.json({
                ok:          true,
                pix_qr_url:  inv.pagarme_payment_url,
                pix_qr_code: inv.pix_qr_code ?? null,
            });
        }

        const { data: company } = await admin
            .from("companies")
            .select("name, email, whatsapp_phone, meta")
            .eq("id", companyId)
            .maybeSingle();

        const amountCents = inv?.amount
            ? Math.round(Number(inv.amount) * 100)
            : getMonthlyPriceCents(sub.plan as "bot" | "complete");

        const cnpj: string = (company?.meta as { cnpj?: string })?.cnpj?.replace(/\D/g, "") ?? "";

        const order = await createPixInvoiceOrder({
            amountCents,
            description: `Mensalidade Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
            customerId:  sub.pagarme_customer_id ?? undefined,
            customer:    !sub.pagarme_customer_id && company
                ? {
                      name:     company.name,
                      email:    company.email ?? `${companyId}@renthus.com.br`,
                      document: cnpj || undefined,
                      phone:    company.whatsapp_phone ?? undefined,
                  }
                : undefined,
            metadata: {
                type:            "invoice",
                company_id:      companyId,
                subscription_id: sub.id,
                invoice_id:      inv?.id ?? "",
                plan:            sub.plan,
            },
        });

        const pixUrl  = extractPixUrl(order);
        const pixCode = extractPixCode(order);

        if (!pixCode && !pixUrl) {
            return NextResponse.json(
                { error: "Erro ao gerar PIX" },
                { status: 500 }
            );
        }

        if (inv) {
            await admin
                .from("invoices")
                .update({
                    pagarme_order_id:    order.id,
                    pagarme_payment_url: pixUrl ?? "",
                    pix_qr_code:         pixCode,
                })
                .eq("id", inv.id);
        } else {
            await admin.from("invoices").insert({
                company_id:          companyId,
                subscription_id:     sub.id,
                amount:              centsToBRL(amountCents),
                status:              "pending",
                due_at:              new Date().toISOString(),
                pagarme_order_id:    order.id,
                pagarme_payment_url: pixUrl ?? "",
                pix_qr_code:         pixCode,
            });
        }

        return NextResponse.json({
            ok:          true,
            pix_qr_url:  pixUrl,
            pix_qr_code: pixCode,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[create-invoice-checkout] Erro:", msg);
        return NextResponse.json({ error: msg || "Erro interno" }, { status: 500 });
    }
}
