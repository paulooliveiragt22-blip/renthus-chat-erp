/**
 * POST /api/billing/switch-period
 *
 * Troca de ciclo mensal → anual (pay-to-switch). Só owner/admin, só assinatura
 * active mensal. Gera PIX prorateado (annual − crédito do mês). Ao pagar, o
 * fulfill vira billing_period='year' e reinicia o ciclo (+1 ano).
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { ensurePeriodSwitchCheckout } from "@/lib/billing/ensurePeriodSwitchCheckout";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function POST() {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const { admin, companyId } = ctx;

        const { data: company } = await admin
            .from("companies")
            .select("id, name, nome_fantasia, email, cnpj, whatsapp_phone, phone")
            .eq("id", companyId)
            .maybeSingle();
        if (!company) {
            return NextResponse.json({ error: "company_not_found" }, { status: 404 });
        }

        try {
            const checkout = await ensurePeriodSwitchCheckout(admin, {
                companyId,
                company: {
                    name: company.name as string | null,
                    nome_fantasia: company.nome_fantasia as string | null,
                    email: company.email as string | null,
                    whatsapp_phone: company.whatsapp_phone as string | null,
                    phone: company.phone as string | null,
                    cnpj: company.cnpj as string | null,
                },
            });

            if (checkout.mode === "applied_free") {
                return NextResponse.json({
                    ok: true,
                    action: "switched",
                    plan: checkout.plan,
                    billing_period: "year",
                });
            }

            return NextResponse.json({
                ok: true,
                action: "period_switch_pending",
                plan: checkout.plan,
                invoice_id: checkout.invoiceId,
                amount_cents: checkout.amountCents,
                amount_brl: checkout.amountBrl,
                annual_cents: checkout.annualCents,
                credit_cents: checkout.creditCents,
                next_billing_at: checkout.nextBillingAt,
                message:
                    "Migração para o anual preparada. Pague abaixo (PIX ou cartão) para confirmar.",
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg === "subscription_not_eligible" ||
                msg === "already_annual" ||
                msg === "plan_invalid" ||
                msg === "never_paid_use_set_period"
                    ? 400
                    : msg === "subscription_not_found" || msg === "company_not_found"
                      ? 404
                      : 500;
            return NextResponse.json({ error: msg }, { status });
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
