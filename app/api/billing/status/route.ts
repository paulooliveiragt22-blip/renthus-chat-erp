import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures, checkLimit } from "@/lib/billing/entitlements";
import { getMonthlyPriceCents, getSetupPriceCents, listCustomerCards } from "@/lib/billing/pagarme";
import { PLAN_CATALOG, getPlanLabel, normalizePlanKey } from "@/lib/billing/planCatalog";
import { ensureAiWallet } from "@/lib/billing/aiWallet";
import { jsonAccessError } from "@/lib/api/errors";

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

        const [sub, features, whatsappUsage, pagarmeSubRaw] = await Promise.all([
            getActiveSubscription(admin, companyId),
            getEnabledFeatures(admin, companyId),
            checkLimit(admin, companyId, "whatsapp_messages", 0),
            admin
                .from("pagarme_subscriptions")
                .select(
                    "id, plan, status, trial_ends_at, next_billing_at, last_paid_at, activated_at, pagarme_customer_id"
                )
                .eq("company_id", companyId)
                .maybeSingle()
                .then(({ data }) => data),
        ]);

        const [{ data: invPending }, { data: setupPending }] = await Promise.all([
            admin
                .from("invoices")
                .select("pagarme_payment_url, pix_qr_code, amount, due_at")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            admin
                .from("setup_payments")
                .select("pagarme_payment_url, pix_qr_code, amount")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const pendingInvoice = invPending ?? null;
        const pendingSetupPayment: {
            pagarme_payment_url: string | null;
            pix_qr_code: string | null;
            amount: number;
        } | null = setupPending ?? null;

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

        const monthlyPricesBRL = {
            essencial: getMonthlyPriceCents("essencial") / 100,
            pro: getMonthlyPriceCents("pro") / 100,
            market: getMonthlyPriceCents("market") / 100,
        };
        const setupPricesBRL = {
            essencial: getSetupPriceCents("essencial") / 100,
            pro: getSetupPriceCents("pro") / 100,
            market: getSetupPriceCents("market") / 100,
        };

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

        return NextResponse.json({
            ok: true,
            company_id: companyId,
            subscription: sub,
            plan_key: planKey,
            plan_label: planKey ? getPlanLabel(planKey) : null,
            plan_catalog: {
                essencial: PLAN_CATALOG.essencial.monthlyPriceCents / 100,
                pro: PLAN_CATALOG.pro.monthlyPriceCents / 100,
                market: PLAN_CATALOG.market.monthlyPriceCents / 100,
            },
            ai_wallet: aiWallet,
            pagarme_subscription: pagarmeSubRaw ?? null,
            pending_invoice: pendingInvoice,
            pending_setup_payment: pendingSetupPayment,
            is_blocked:
                subStatus === "blocked" ||
                subStatus === "pending_payment" ||
                subStatus === "pending_setup",
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
            })),
            monthly_prices_brl: monthlyPricesBRL,
            setup_prices_brl: setupPricesBRL,
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
