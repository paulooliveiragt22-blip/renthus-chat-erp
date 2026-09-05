/**
 * Primeira fatura (signup pay-to-start, pós-trial ou re-geração never-paid).
 *
 * Period-aware e canônico: o amount + kind (subscription|year) vêm de
 * rpc_create_billing_obligation (lê pagarme_subscriptions.billing_period e
 * calcula o valor no banco — mensal ou anual com desconto). O app nunca
 * calcula o valor; aqui só anexa o PIX Pagar.me (best-effort) à invoice.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { normalizePlanKey } from "@/lib/billing/planCatalog";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

type ObligationResult = {
    status?: string;
    invoice_id?: string;
    amount_cents?: number;
    kind?: string;
};

export async function createInitialInvoice(
    admin: Admin,
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    // 1) Obrigação canônica no banco (mensal ou anual conforme billing_period).
    const { data: raw, error: obErr } = await admin.rpc("rpc_create_billing_obligation", {
        p_company_id: companyId,
        p_kind: "subscription",
    });
    if (obErr) {
        throw new Error(obErr.message);
    }
    const ob = (raw ?? {}) as ObligationResult;
    const invoiceId = ob.invoice_id ?? null;
    if (!invoiceId) {
        throw new Error("obligation_no_invoice");
    }
    const amountCents = Number(ob.amount_cents ?? 0);
    const kind = String(ob.kind ?? "subscription");

    // 2) Invoice já paga/gerada com PIX? Reaproveita (idempotente).
    const { data: inv } = await admin
        .from("invoices")
        .select("id, subscription_id, pagarme_order_id, pix_qr_code, status")
        .eq("id", invoiceId)
        .maybeSingle();

    if (inv?.pagarme_order_id && typeof inv.pix_qr_code === "string" && inv.pix_qr_code) {
        return { invoiceId, pixCode: inv.pix_qr_code };
    }

    if (amountCents <= 0) {
        // amount canônico inválido — não força PIX; UI regenera depois.
        return { invoiceId, pixCode: null };
    }

    // 3) Dados de empresa/sub para o payload PSP.
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, pagarme_customer_id")
        .eq("company_id", companyId)
        .maybeSingle();

    const { data: company, error: compErr } = await admin
        .from("companies")
        .select("id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj")
        .eq("id", companyId)
        .maybeSingle();
    if (compErr || !company) {
        throw new Error(compErr?.message ?? "Empresa não encontrada");
    }

    const planKey = normalizePlanKey(String(sub?.plan ?? "")) ?? "essencial";
    const isYear = kind === "year";
    const compLabel = (company.nome_fantasia ?? company.name ?? "").trim() || "Renthus";
    const description = isYear
        ? `Plano anual Renthus — ${planKey}`
        : `Mensalidade Renthus — Plano ${planKey}`;

    if (!process.env.PAGARME_API_KEY?.trim()) {
        billingLog("signup_invoice", "pagarme_skipped_no_key", { company_id: companyId });
        return { invoiceId, pixCode: null };
    }

    let orderId: string | null = null;
    let pixUrl: string | null = null;
    let pixCode: string | null = null;
    try {
        const created = await createPixInvoiceOrder({
            amountCents,
            description,
            itemCode: isYear ? "anuidade" : "mensalidade",
            customerId: sub?.pagarme_customer_id ?? undefined,
            customer: !sub?.pagarme_customer_id
                ? buildPagarmeCustomerPayload({
                      id: companyId,
                      name: company.name,
                      nome_fantasia: company.nome_fantasia,
                      email: company.email,
                      whatsapp_phone: company.whatsapp_phone,
                      cnpj: company.cnpj,
                      meta: (company.meta as Record<string, unknown> | null) ?? null,
                  })
                : undefined,
            additionalInfo: [
                { name: "Empresa", value: compLabel },
                { name: "Tipo", value: isYear ? "Plano anual (à vista)" : "Primeira mensalidade" },
            ],
            metadata: {
                type: "invoice",
                company_id: companyId,
                subscription_id: inv?.subscription_id ?? sub?.id ?? null,
                plan: planKey,
                kind,
            },
        });
        const resolved = await resolvePixFromOrder(created);
        orderId = resolved.order.id;
        pixUrl = resolved.pixUrl;
        pixCode = resolved.pixCode;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[createInitialInvoice] Pagar.me:", msg);
        billingLog("signup_invoice", "pagarme_pix_prep_failed", {
            company_id: companyId,
            invoice_id: invoiceId,
            error: msg,
        });
        // Mantém invoice pending — falha foi só no PIX automático do signup; o cliente
        // paga em /plano/pagar (cartão ou PIX). Não marcar failed sem tentativa de pagamento.
        return { invoiceId, pixCode: null };
    }

    await admin
        .from("invoices")
        .update({
            pagarme_order_id: orderId,
            pagarme_payment_url: pixUrl ?? "",
            pix_qr_code: pixCode,
        })
        .eq("id", invoiceId);

    billingLog("signup_invoice", "created", {
        company_id: companyId,
        invoice_id: invoiceId,
        order_id: orderId,
        kind,
    });

    return { invoiceId, pixCode };
}
