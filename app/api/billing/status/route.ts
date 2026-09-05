import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures, checkLimit } from "@/lib/billing/entitlements";
import { listCustomerCards } from "@/lib/billing/pagarme";
import { getPlanLabel, normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { loadCommercialPlanPricing } from "@/lib/billing/loadCommercialPlanPricing";
import {
    yearlyDiscountLabelPercent,
    type YearlyDiscountMode,
} from "@/lib/billing/yearlyFromDiscount";
import { ensureAiWallet } from "@/lib/billing/aiWallet";
import { jsonAccessError } from "@/lib/api/errors";
import { syncPendingObligationFromPsp } from "@/lib/billing/syncPendingObligationFromPsp";

export const runtime = "nodejs";

/** Cookie workspace only — sem ?company_id= (IDOR fechado, P0.3). */
export async function GET() {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const { admin, companyId } = ctx;

        // Rede de segurança: paywall já polla status a cada 5s — se webhook falhou
        // e o order PSP está paid, libera com o mesmo FulfillPayment.
        const pspSync = await syncPendingObligationFromPsp(admin, companyId);

        const [sub, features, whatsappUsage, pagarmeSubRaw] = await Promise.all([
            getActiveSubscription(admin, companyId),
            getEnabledFeatures(admin, companyId),
            checkLimit(admin, companyId, "whatsapp_messages", 0),
            admin
                .from("pagarme_subscriptions")
                .select(
                    "id, plan, status, billing_period, trial_ends_at, next_billing_at, last_paid_at, activated_at, pagarme_customer_id, default_card_id, pending_plan_key, pending_plan_change_at, pending_keep_user_ids, seat_quantity"
                )
                .eq("company_id", companyId)
                .maybeSingle()
                .then(({ data }) => data),
        ]);

        const planByKey = await loadCommercialPlanPricing(admin);
        if (planByKey.size < 3) {
            throw new Error("commercial_plan_pricing_unavailable");
        }
        const listCents = (key: CommercialPlanKey, field: "price_cents" | "price_year_cents") =>
            planByKey.get(key)?.[field] ?? 0;
        const yearlyPricesBRL = {
            essencial: listCents("essencial", "price_year_cents") / 100,
            pro: listCents("pro", "price_year_cents") / 100,
            market: listCents("market", "price_year_cents") / 100,
        };
        const yearlySavingsOf = (key: CommercialPlanKey) => {
            const row = planByKey.get(key);
            if (!row) return 0;
            return yearlyDiscountLabelPercent(
                row.yearly_discount_mode as YearlyDiscountMode | undefined,
                row.yearly_discount_value,
                row.price_cents,
                row.price_year_cents
            );
        };
        const yearlySavingsPercent = {
            essencial: yearlySavingsOf("essencial"),
            pro: yearlySavingsOf("pro"),
            market: yearlySavingsOf("market"),
        };
        const monthlyPricesBRL = {
            essencial: listCents("essencial", "price_cents") / 100,
            pro: listCents("pro", "price_cents") / 100,
            market: listCents("market", "price_cents") / 100,
        };

        const { data: invPending } = await admin
            .from("invoices")
            .select("pagarme_payment_url, pix_qr_code, amount, due_at, kind")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const pendingInvoice = invPending ?? null;

        const { data: invoiceRows } = await admin
            .from("invoices")
            .select("id, amount, status, due_at, paid_at, created_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(12);

        const customerId = (pagarmeSubRaw as { pagarme_customer_id?: string | null } | null)
            ?.pagarme_customer_id;
        const savedCards =
            customerId && typeof customerId === "string"
                ? await listCustomerCards(customerId)
                : [];

        let aiWallet = null;
        try {
            aiWallet = await ensureAiWallet(admin, companyId);
        } catch {
            aiWallet = null;
        }

        const planKey = normalizePlanKey(
            String((pagarmeSubRaw as { plan?: string } | null)?.plan ?? sub?.plan_key ?? "")
        );

        const subStatus = String(pagarmeSubRaw?.status ?? "");
        const obligationAmount =
            pendingInvoice?.amount != null ? Number(pendingInvoice.amount) : null;
        const planRow = planKey ? planByKey.get(planKey) : undefined;
        const pendingKind = String(pendingInvoice?.kind ?? "");
        const canonicalObligationCents =
            planRow == null
                ? null
                : pendingKind === "year" || pendingKind === "period_switch"
                  ? planRow.price_year_cents
                  : planRow.price_cents;
        const canonicalObligationBrl =
            canonicalObligationCents != null ? canonicalObligationCents / 100 : null;
        const canonicalMonthly = planRow != null ? planRow.price_cents / 100 : null;
        const amountMismatch =
            canonicalObligationBrl != null &&
            obligationAmount != null &&
            Number.isFinite(obligationAmount) &&
            Math.abs(obligationAmount - canonicalObligationBrl) > 0.02;

        return NextResponse.json({
            ok: true,
            company_id: companyId,
            role: ctx.role,
            subscription: sub,
            plan_key: planKey,
            plan_label: planKey ? getPlanLabel(planKey) : null,
            plan_catalog: monthlyPricesBRL,
            ai_wallet: aiWallet,
            pagarme_subscription: pagarmeSubRaw ?? null,
            pending_invoice: pendingInvoice,
            psp_sync: pspSync,
            obligation_amount_brl: obligationAmount,
            canonical_monthly_brl: canonicalMonthly,
            amount_mismatch: amountMismatch,
            is_blocked:
                subStatus === "blocked" ||
                subStatus === "pending_payment" ||
                subStatus === "pending_setup" ||
                subStatus === "abandoned",
            invoice_history: invoiceRows ?? [],
            saved_cards: savedCards.map((c) => ({
                id: c.id ?? "",
                brand: c.brand ?? "",
                last_four: c.last_four_digits ?? "",
                holder: c.holder_name ?? "",
                exp:
                    c.exp_month && c.exp_year
                        ? `${String(c.exp_month).padStart(2, "0")}/${c.exp_year}`
                        : "",
                status: c.status ?? "",
                is_default:
                    Boolean(c.id) &&
                    c.id ===
                        (pagarmeSubRaw as { default_card_id?: string | null } | null)
                            ?.default_card_id,
            })),
            default_card_id:
                (pagarmeSubRaw as { default_card_id?: string | null } | null)?.default_card_id ??
                null,
            monthly_prices_brl: monthlyPricesBRL,
            yearly_prices_brl: yearlyPricesBRL,
            yearly_savings_percent: yearlySavingsPercent,
            enabled_features: Array.from(features.values()),
            enabled_features_count: features.size,
            usage: {
                whatsapp_messages: whatsappUsage,
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unexpected error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
