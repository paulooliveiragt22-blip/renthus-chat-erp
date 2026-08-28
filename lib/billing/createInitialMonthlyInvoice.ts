/**
 * Primeira fatura mensal (signup pay-to-start ou pós-trial).
 * Best-effort Pagar.me: falha na API não reverte a subscription pending.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    getMonthlyPriceCents,
    centsToBRL,
    resolvePixFromOrder,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { normalizePlanKey } from "@/lib/billing/planCatalog";
import { billingLog } from "@/lib/billing/billingLog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";

type Admin = ReturnType<typeof createAdminClient>;

export async function createInitialMonthlyInvoice(
    admin: Admin,
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, pagarme_customer_id")
        .eq("company_id", companyId)
        .maybeSingle();

    if (subErr || !sub?.id) {
        throw new Error(subErr?.message ?? "Assinatura não encontrada para fatura inicial");
    }

    const { data: existing } = await admin
        .from("invoices")
        .select("id, pix_qr_code")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .maybeSingle();

    if (existing?.id) {
        billingLog("signup_invoice", "skip_existing_pending", { company_id: companyId });
        return {
            invoiceId: existing.id,
            pixCode:   typeof existing.pix_qr_code === "string" ? existing.pix_qr_code : null,
        };
    }

    const { data: company, error: compErr } = await admin
        .from("companies")
        .select("id, name, nome_fantasia, email, whatsapp_phone, meta, cnpj")
        .eq("id", companyId)
        .maybeSingle();

    if (compErr || !company) {
        throw new Error(compErr?.message ?? "Empresa não encontrada");
    }

    const planKey = normalizePlanKey(String(sub.plan ?? "")) ?? "essencial";
    const amountCents = getMonthlyPriceCents(planKey);
    const now = new Date();
    const compLabel =
        (company.nome_fantasia ?? company.name ?? "").trim() || "Renthus";

    const { data: claimed, error: claimErr } = await admin
        .from("invoices")
        .insert({
            company_id:          companyId,
            subscription_id:     sub.id,
            amount:              centsToBRL(amountCents),
            status:              "pending",
            due_at:              now.toISOString(),
            pagarme_order_id:    null,
            pagarme_payment_url: "",
            pix_qr_code:         null,
        })
        .select("id")
        .single();

    if (claimErr) {
        if (isUniqueViolation(claimErr)) {
            const { data: again } = await admin
                .from("invoices")
                .select("id, pix_qr_code")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .maybeSingle();
            return {
                invoiceId: again?.id ?? null,
                pixCode:   typeof again?.pix_qr_code === "string" ? again.pix_qr_code : null,
            };
        }
        throw new Error(claimErr.message);
    }

    const claimId = claimed.id as string;
    let orderId: string | null = null;
    let pixUrl: string | null = null;
    let pixCode: string | null = null;

    if (process.env.PAGARME_API_KEY?.trim()) {
        try {
            const created = await createPixInvoiceOrder({
                amountCents,
                description: `Mensalidade Renthus — Plano ${planKey}`,
                itemCode:    "mensalidade",
                customerId:  sub.pagarme_customer_id ?? undefined,
                customer:    !sub.pagarme_customer_id
                    ? buildPagarmeCustomerPayload({
                          id:               companyId,
                          name:             company.name,
                          nome_fantasia:    company.nome_fantasia,
                          email:            company.email,
                          whatsapp_phone:   company.whatsapp_phone,
                          cnpj:             company.cnpj,
                          meta:             (company.meta as Record<string, unknown> | null) ?? null,
                      })
                    : undefined,
                additionalInfo: [
                    { name: "Empresa", value: compLabel },
                    { name: "Tipo",    value: "Primeira mensalidade" },
                ],
                metadata: {
                    type:            "invoice",
                    company_id:      companyId,
                    subscription_id: sub.id,
                    plan:            planKey,
                },
            });
            const resolved = await resolvePixFromOrder(created);
            orderId = resolved.order.id;
            pixUrl = resolved.pixUrl;
            pixCode = resolved.pixCode;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[createInitialMonthlyInvoice] Pagar.me:", msg);
            billingLog("signup_invoice", "pagarme_error", { company_id: companyId, error: msg });
            await admin.from("invoices").update({ status: "failed" }).eq("id", claimId);
            return { invoiceId: null, pixCode: null };
        }
    } else {
        billingLog("signup_invoice", "pagarme_skipped_no_key", { company_id: companyId });
    }

    await admin
        .from("invoices")
        .update({
            pagarme_order_id:    orderId,
            pagarme_payment_url: pixUrl ?? "",
            pix_qr_code:         pixCode,
        })
        .eq("id", claimId);

    billingLog("signup_invoice", "created", {
        company_id:  companyId,
        invoice_id:  claimId,
        order_id:    orderId,
    });

    return { invoiceId: claimId, pixCode };
}
