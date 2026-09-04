/**
 * POST /api/billing/change-plan
 *
 * Trial: qualquer plano comercial (imediato).
 * Active + upgrade: proration PIX (BN-11) — plano só após pagar.
 * Active + downgrade: agenda fim do ciclo (keep_user_ids se excesso). BN-12/R3-4.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";
import { normalizePlanKey, parseCommercialPlanInput, planRank } from "@/lib/billing/planCatalog";
import { rebillPendingObligationAfterPlanChange } from "@/lib/billing/rebillPendingObligation";
import { scheduleDowngrade } from "@/lib/billing/scheduleDowngrade";
import { ensurePlanUpgradeCheckout } from "@/lib/billing/ensurePlanUpgradeCheckout";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

type Body = { plan?: string; keep_user_ids?: string[] };

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const { admin, companyId } = ctx;
        const body = (await req.json()) as Body;
        const planKey = parseCommercialPlanInput(body?.plan);
        if (!planKey) {
            return NextResponse.json(
                { error: "Plano inválido. Use 'essencial', 'pro' ou 'market'." },
                { status: 400 }
            );
        }

        const { data: row, error: fetchErr } = await admin
            .from("pagarme_subscriptions")
            .select("id, plan, status, pending_plan_key")
            .eq("company_id", companyId)
            .maybeSingle();

        if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
        if (!row?.id) {
            return NextResponse.json(
                { error: "Assinatura não encontrada para esta empresa." },
                { status: 404 }
            );
        }

        const st = String(row.status ?? "");
        const current = normalizePlanKey(String(row.plan ?? "")) ?? String(row.plan ?? "");

        if (
            st === "blocked" ||
            st === "cancelled" ||
            st === "pending_payment" ||
            st === "pending_setup" ||
            st === "overdue"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Não é possível alterar o plano nesta situação. Regularize o pagamento primeiro.",
                },
                { status: 400 }
            );
        }

        if (current === planKey) {
            const rebill = await rebillPendingObligationAfterPlanChange(admin, companyId, planKey);
            return NextResponse.json({ ok: true, action: "noop", plan: current, rebill });
        }

        if (st === "trial") {
            const { error: upErr } = await admin
                .from("pagarme_subscriptions")
                .update({
                    plan: planKey,
                    pending_plan_key: null,
                    pending_plan_change_at: null,
                    pending_keep_user_ids: null,
                })
                .eq("id", row.id);

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
            await syncLogicalSubscription(admin, companyId, planKey);
            const rebill = await rebillPendingObligationAfterPlanChange(admin, companyId, planKey);
            return NextResponse.json({ ok: true, action: "changed", plan: planKey, rebill });
        }

        if (st === "active" && planRank(planKey) > planRank(current)) {
            const { data: company } = await admin
                .from("companies")
                .select("id, name, nome_fantasia, email, cnpj, whatsapp_phone, phone")
                .eq("id", companyId)
                .maybeSingle();
            if (!company) {
                return NextResponse.json({ error: "company_not_found" }, { status: 404 });
            }

            try {
                const checkout = await ensurePlanUpgradeCheckout(admin, {
                    companyId,
                    targetPlan: planKey,
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
                        action: "upgraded",
                        plan: checkout.toPlan,
                        from_plan: checkout.fromPlan,
                    });
                }

                return NextResponse.json({
                    ok: true,
                    action: "upgrade_checkout",
                    from_plan: checkout.fromPlan,
                    to_plan: checkout.toPlan,
                    invoice_id: checkout.invoiceId,
                    order_id: checkout.orderId,
                    amount_cents: checkout.amountCents,
                    amount_brl: checkout.amountBrl,
                    pix_qr_code: checkout.pixQrCode,
                    pix_url: checkout.pixUrl,
                    next_billing_at: checkout.nextBillingAt,
                    message:
                        "Pague o PIX do upgrade (prorata). Após confirmação o plano sobe; a renovação segue na data atual.",
                });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                const status =
                    msg === "subscription_not_eligible" ||
                    msg === "not_an_upgrade" ||
                    msg === "plan_invalid"
                        ? 400
                        : 500;
                return NextResponse.json({ error: msg }, { status });
            }
        }

        if (st === "active" && planRank(planKey) < planRank(current)) {
            const scheduled = await scheduleDowngrade(admin, companyId, {
                plan: planKey,
                keep_user_ids: Array.isArray(body.keep_user_ids) ? body.keep_user_ids : undefined,
            });
            if (!scheduled.ok) {
                return NextResponse.json(
                    { error: scheduled.error },
                    { status: scheduled.status }
                );
            }
            return NextResponse.json({
                ...scheduled,
                action: "downgrade_scheduled",
            });
        }

        return NextResponse.json(
            {
                error: "Alteração de plano não permitida nesta situação.",
            },
            { status: 400 }
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
