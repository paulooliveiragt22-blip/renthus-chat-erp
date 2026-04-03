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
    getSetupPriceCents,
    centsToBRL,
    isOrderCreditPaid,
} from "@/lib/billing/pagarme";
import { applyMonthlyInvoicePaid } from "@/lib/billing/applyMonthlyInvoicePaid";
import { activateAfterSetupPayment, syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";

export const runtime = "nodejs";

type Body = {
    payment_method?:  "pix" | "credit_card";
    card_token?:      string;
    installments?:    number;
    billing_address?: {
        cep:      string;
        endereco: string;
        numero:   string;
        bairro?:  string;
        cidade:   string;
        uf:       string;
    };
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

        // Primeiro pagamento (trial / pending_setup) = taxa de setup
        // Pagamentos seguintes (active / overdue / blocked) = mensalidade
        const isFirstPayment =
            sub.status === "trial" || sub.status === "pending_setup";

        const plan = sub.plan as "bot" | "complete";

        // Busca registro pendente de acordo com o tipo de pagamento
        const [{ data: pendingSetup }, { data: pendingInv }] = await Promise.all([
            admin
                .from("setup_payments")
                .select("id, amount, pagarme_order_id, pagarme_payment_url")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            admin
                .from("invoices")
                .select("id, amount, pagarme_order_id, pagarme_payment_url, pix_qr_code")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const pendingRecord = isFirstPayment ? pendingSetup : pendingInv;

        const amountCents = pendingRecord?.amount
            ? Math.round(Number(pendingRecord.amount) * 100)
            : isFirstPayment
                ? getSetupPriceCents(plan)
                : getMonthlyPriceCents(plan);

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

        const customerBase = buildPagarmeCustomerPayload({
            id:               companyId,
            name:             company.name as string | null,
            nome_fantasia:    company.nome_fantasia as string | null,
            email:            company.email as string | null,
            whatsapp_phone:   company.whatsapp_phone as string | null,
            cnpj:             company.cnpj as string | null,
            meta:             (company.meta as Record<string, unknown> | null) ?? null,
        });

        const metaType = isFirstPayment ? "setup" : "invoice";
        const orderMeta = {
            type:            metaType,
            company_id:      companyId,
            subscription_id: sub.id,
            plan:            String(plan),
        };
        const planLabel = plan === "bot" ? "Bot" : "Completo";

        if (paymentMethod === "credit_card") {
            const token = body.card_token?.trim();
            if (!token) {
                return NextResponse.json({ error: "Token do cartão ausente" }, { status: 400 });
            }

            const installments = Math.max(1, Math.min(12, Number(body.installments) || 1));

            const bodyAddr = body.billing_address;
            const street  = (bodyAddr?.endereco?.trim() || String(company.endereco ?? "")).trim();
            const num     = (bodyAddr?.numero?.trim()   || String(company.numero   ?? "")).trim();
            const bairro  = (bodyAddr?.bairro?.trim()   || String((company as any).bairro ?? "")).trim();
            const city    = (bodyAddr?.cidade?.trim()   || String(company.cidade   ?? "")).trim();
            const uf      = (bodyAddr?.uf?.trim()       || String(company.uf       ?? "")).trim();
            let zip       = (bodyAddr?.cep ?? String(company.cep ?? "")).replace(/\D/g, "");

            if (!street || !num || !city || uf.length < 2) {
                return NextResponse.json(
                    { error: "Preencha o endereço de cobrança (endereço, número, cidade e UF) para pagar com cartão." },
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

            const line1Parts = [num, street, bairro].filter(Boolean);
            const cnpjDigits = (company.cnpj as string | null ?? "").replace(/\D/g, "");

            const order = await createSetupOrder({
                amountCents,
                description:     isFirstPayment
                    ? `Taxa de ativação Renthus — Plano ${planLabel}`
                    : `Mensalidade Renthus — Plano ${planLabel}`,
                installments,
                cardToken:       token,
                itemCode:        isFirstPayment ? "setup" : "mensalidade",
                holderDocument:  cnpjDigits || undefined,
                customerId:      sub.pagarme_customer_id ?? undefined,
                customer:        !sub.pagarme_customer_id ? customerBase : undefined,
                billingAddress: {
                    line_1:   line1Parts.join(", "),
                    line_2:   "",
                    zip_code: zip,
                    city,
                    state:    uf.slice(0, 2).toUpperCase(),
                    country:  "BR",
                },
                metadata: orderMeta,
            });

            const custId = extractOrderCustomerId(order);

            if (isFirstPayment) {
                // Upsert setup_payment
                if (pendingSetup) {
                    await admin.from("setup_payments")
                        .update({ pagarme_order_id: order.id, pagarme_payment_url: "" })
                        .eq("id", pendingSetup.id);
                } else {
                    await admin.from("setup_payments").insert({
                        company_id:          companyId,
                        plan,
                        amount:              centsToBRL(amountCents),
                        installments,
                        status:              "pending",
                        pagarme_order_id:    order.id,
                        pagarme_payment_url: "",
                    });
                }
            } else {
                // Upsert invoice
                if (pendingInv) {
                    await admin.from("invoices")
                        .update({ pagarme_order_id: order.id, pagarme_payment_url: "", pix_qr_code: null })
                        .eq("id", pendingInv.id);
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
            }

            if (custId) {
                await admin.from("pagarme_subscriptions")
                    .update({ pagarme_customer_id: custId })
                    .eq("id", sub.id);
            }

            if (isOrderCreditPaid(order)) {
                if (isFirstPayment) {
                    await activateAfterSetupPayment(admin, companyId, plan, custId ?? undefined);
                    await syncLogicalSubscription(admin, companyId, plan);
                } else {
                    await applyMonthlyInvoicePaid(admin, order.id, { pagarmeCustomerId: custId });
                }
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
                message:        "Pagamento em análise. Quando o banco aprovar, o plano será liberado automaticamente.",
            });
        }

        // ── PIX ───────────────────────────────────────────────────────────
        const existingPixUrl  = pendingRecord?.pagarme_payment_url ?? null;
        const existingPixCode = (pendingRecord as any)?.pix_qr_code ?? null;
        const hasHostedCheckout = existingPixUrl?.includes("checkout.pagar.me") ?? false;

        if (pendingRecord?.pagarme_order_id && existingPixUrl && !hasHostedCheckout) {
            return NextResponse.json({
                ok:             true,
                payment_method: "pix",
                pix_qr_url:     existingPixUrl,
                pix_qr_code:    existingPixCode,
            });
        }

        const companyLabel = (company.nome_fantasia as string | null)?.trim()
            || (company.name as string | null)?.trim()
            || "Renthus";

        const order = await createPixInvoiceOrder({
            amountCents,
            description: isFirstPayment
                ? `Taxa de ativação Renthus — Plano ${planLabel}`
                : `Mensalidade Renthus — Plano ${planLabel}`,
            itemCode:   isFirstPayment ? "setup" : "mensalidade",
            customerId: sub.pagarme_customer_id ?? undefined,
            customer:   !sub.pagarme_customer_id ? customerBase : undefined,
            additionalInfo: [
                { name: "Empresa", value: companyLabel },
                { name: "Tipo",    value: isFirstPayment ? "Taxa de ativação" : "Mensalidade" },
            ],
            metadata: orderMeta,
        });

        const pixUrl  = extractPixUrl(order);
        const pixCode = extractPixCode(order);

        if (!pixCode && !pixUrl) {
            return NextResponse.json({ error: "Erro ao gerar PIX" }, { status: 500 });
        }

        if (isFirstPayment) {
            if (pendingSetup) {
                await admin.from("setup_payments")
                    .update({ pagarme_order_id: order.id, pagarme_payment_url: pixUrl ?? "" })
                    .eq("id", pendingSetup.id);
            } else {
                await admin.from("setup_payments").insert({
                    company_id:          companyId,
                    plan,
                    amount:              centsToBRL(amountCents),
                    installments:        1,
                    status:              "pending",
                    pagarme_order_id:    order.id,
                    pagarme_payment_url: pixUrl ?? "",
                });
            }
        } else {
            if (pendingInv) {
                await admin.from("invoices")
                    .update({ pagarme_order_id: order.id, pagarme_payment_url: pixUrl ?? "", pix_qr_code: pixCode })
                    .eq("id", pendingInv.id);
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
