/**
 * POST /api/billing/create-invoice-checkout
 *
 * Mensalidade Renthus — PIX ou cartão (token no browser).
 * Exige sessão + workspace (owner/admin). Libera o plano na hora se o cartão for aprovado
 * ou quando o webhook confirmar PIX / cartão em análise.
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    createPixInvoiceOrder,
    createSetupOrder,
    extractPixCode,
    extractPixUrl,
    extractOrderCustomerId,
    getMonthlyPriceCents,
    centsToBRL,
    isOrderCreditPaid,
} from "@/lib/billing/pagarme";
import { applyMonthlyInvoicePaid } from "@/lib/billing/applyMonthlyInvoicePaid";

export const runtime = "nodejs";

type Body = {
    payment_method?: "pix" | "credit_card";
    card_token?:    string;
    installments?:  number;
};

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const companyId = ctx.companyId;
        const body      = (await req.json().catch(() => ({}))) as Body;
        const paymentMethod =
            body.payment_method === "credit_card" ? "credit_card" : "pix";

        const admin = createAdminClient();

        const { data: sub, error: subErr } = await admin
            .from("pagarme_subscriptions")
            .select("id, plan, status, pagarme_customer_id")
            .eq("company_id", companyId)
            .maybeSingle();

        if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
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

        const amountCents = inv?.amount
            ? Math.round(Number(inv.amount) * 100)
            : getMonthlyPriceCents(sub.plan as "bot" | "complete");

        const { data: company, error: compErr } = await admin
            .from("companies")
            .select(
                "name, nome_fantasia, email, whatsapp_phone, meta, cnpj, cep, endereco, numero, cidade, uf"
            )
            .eq("id", companyId)
            .maybeSingle();

        if (compErr || !company) {
            return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
        }

        const cnpjDigits =
            (company.cnpj as string | null)?.replace(/\D/g, "") ||
            ((company.meta as { cnpj?: string } | null)?.cnpj ?? "").replace(/\D/g, "");

        const displayName =
            (company.nome_fantasia as string | null)?.trim() ||
            (company.name as string | null)?.trim() ||
            "Empresa";

        const metaInvoice = {
            type:            "invoice" as const,
            company_id:      companyId,
            subscription_id: sub.id,
            invoice_id:      inv?.id ?? "",
            plan:            String(sub.plan ?? ""),
        };

        if (paymentMethod === "credit_card") {
            const token = body.card_token?.trim();
            if (!token) {
                return NextResponse.json({ error: "Token do cartão ausente" }, { status: 400 });
            }

            const installments = Math.max(1, Math.min(12, Number(body.installments) || 1));

            const street = String(company.endereco ?? "").trim();
            const num    = String(company.numero ?? "").trim();
            const city   = String(company.cidade ?? "").trim();
            const uf     = String(company.uf ?? "").trim();
            let zip      = String(company.cep ?? "").replace(/\D/g, "");

            if (!street || !num || !city || uf.length < 2) {
                return NextResponse.json(
                    {
                        error:
                            "Preencha endereço, número, cidade e UF na aba Geral (Configurações) para pagar com cartão.",
                    },
                    { status: 400 }
                );
            }
            if (zip.length > 0 && zip.length < 8) zip = zip.padStart(8, "0");
            if (zip.length < 8) {
                return NextResponse.json(
                    { error: "CEP completo (8 dígitos) é obrigatório para pagamento com cartão." },
                    { status: 400 }
                );
            }

            const line1 = `${num}, ${street}`;

            const order = await createSetupOrder({
                amountCents,
                description: `Mensalidade Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
                installments,
                cardToken: token,
                itemCode:  "mensalidade",
                customerId: sub.pagarme_customer_id ?? undefined,
                customer:    !sub.pagarme_customer_id
                    ? {
                          name:     displayName,
                          email:    (company.email as string) ?? `${companyId}@renthus.com.br`,
                          document: cnpjDigits || undefined,
                          phone:    (company.whatsapp_phone as string) ?? undefined,
                      }
                    : undefined,
                billingAddress: {
                    line_1:   line1,
                    line_2:   "",
                    zip_code: zip,
                    city,
                    state:    uf.slice(0, 2).toUpperCase(),
                    country:  "BR",
                },
                metadata: metaInvoice,
            });

            const custId = extractOrderCustomerId(order);

            if (inv) {
                await admin
                    .from("invoices")
                    .update({
                        pagarme_order_id:    order.id,
                        pagarme_payment_url: "",
                        pix_qr_code:         null,
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
                    pagarme_payment_url: "",
                    pix_qr_code:         null,
                });
            }

            if (custId) {
                await admin
                    .from("pagarme_subscriptions")
                    .update({ pagarme_customer_id: custId })
                    .eq("id", sub.id);
            }

            if (isOrderCreditPaid(order)) {
                await applyMonthlyInvoicePaid(admin, order.id, { pagarmeCustomerId: custId });
                return NextResponse.json({
                    ok:             true,
                    payment_method: "credit_card",
                    payment_status: "paid",
                    message:        "Pagamento aprovado. Plano liberado.",
                });
            }

            return NextResponse.json({
                ok:             true,
                payment_method: "credit_card",
                payment_status: "pending",
                order_id:       order.id,
                message:
                    "Pagamento em análise. Quando o banco aprovar, o plano será liberado automaticamente.",
            });
        }

        // ── PIX ───────────────────────────────────────────────────────────
        if (inv?.pagarme_order_id && inv.pagarme_payment_url && !hasHostedCheckout) {
            return NextResponse.json({
                ok:             true,
                payment_method: "pix",
                pix_qr_url:     inv.pagarme_payment_url,
                pix_qr_code:    inv.pix_qr_code ?? null,
            });
        }

        const order = await createPixInvoiceOrder({
            amountCents,
            description: `Mensalidade Renthus — Plano ${sub.plan === "bot" ? "Bot" : "Completo"}`,
            customerId:  sub.pagarme_customer_id ?? undefined,
            customer:    !sub.pagarme_customer_id
                ? {
                      name:     displayName,
                      email:    (company.email as string) ?? `${companyId}@renthus.com.br`,
                      document: cnpjDigits || undefined,
                      phone:    (company.whatsapp_phone as string) ?? undefined,
                  }
                : undefined,
            metadata: metaInvoice,
        });

        const pixUrl  = extractPixUrl(order);
        const pixCode = extractPixCode(order);

        if (!pixCode && !pixUrl) {
            return NextResponse.json({ error: "Erro ao gerar PIX" }, { status: 500 });
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
            ok:             true,
            payment_method: "pix",
            pix_qr_url:     pixUrl,
            pix_qr_code:    pixCode,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[create-invoice-checkout] Erro:", msg);
        return NextResponse.json({ error: msg || "Erro interno" }, { status: 500 });
    }
}
