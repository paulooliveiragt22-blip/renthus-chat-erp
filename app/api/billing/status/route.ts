import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures, checkLimit } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMonthlyPriceCents, getSetupPriceCents, listCustomerCards } from "@/lib/billing/pagarme";
import { PLAN_CATALOG, getPlanLabel, normalizePlanKey } from "@/lib/billing/planCatalog";
import { ensureAiWallet } from "@/lib/billing/aiWallet";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        // Suporta ?company_id=xxx (chamada interna/painel) além do cookie de workspace
        const url       = new URL(req.url);
        const qCompanyId = url.searchParams.get("company_id");

        // Página admin: só owner/admin
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId: cookieCompanyId } = ctx;
        const companyId = qCompanyId ?? cookieCompanyId;

        const [sub, features, whatsappUsage, pagarmeSubRaw] = await Promise.all([
            getActiveSubscription(admin, companyId),
            getEnabledFeatures(admin, companyId),
            checkLimit(admin, companyId, "whatsapp_messages", 0),
            // Status da assinatura Pagar.me
            admin
                .from("pagarme_subscriptions")
                .select(
                    "id, plan, status, trial_ends_at, next_billing_at, last_paid_at, activated_at, pagarme_customer_id"
                )
                .eq("company_id", companyId)
                .maybeSingle()
                .then(({ data }) => data),
        ]);

        // Registros pendentes — setup_payment (primeiro pagamento) ou invoice (mensalidade)
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
                .select("pagarme_payment_url, amount")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const pendingInvoice = invPending ?? null;
        const pendingSetupPayment: {
            pagarme_payment_url: string | null;
            amount:              number;
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
            pro:       getMonthlyPriceCents("pro") / 100,
            market:    getMonthlyPriceCents("market") / 100,
            // aliases legados (UI antiga)
            bot:      getMonthlyPriceCents("essencial") / 100,
            complete: getMonthlyPriceCents("pro") / 100,
        };
        const setupPricesBRL = {
            essencial: getSetupPriceCents("essencial") / 100,
            pro:       getSetupPriceCents("pro") / 100,
            market:    getSetupPriceCents("market") / 100,
            bot:      getSetupPriceCents("essencial") / 100,
            complete: getSetupPriceCents("pro") / 100,
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
            pending_invoice:        pendingInvoice,
            pending_setup_payment: pendingSetupPayment,
            is_blocked: pagarmeSubRaw?.status === "blocked",
            invoice_history: invoiceRows ?? [],
            saved_cards: savedCards.map((c) => ({
                id:               c.id ?? "",
                brand:            c.brand ?? "",
                last_four:        c.last_four_digits ?? "",
                holder:           c.holder_name ?? "",
                exp:              c.exp_month && c.exp_year ? `${String(c.exp_month).padStart(2, "0")}/${c.exp_year}` : "",
                status:           c.status ?? "",
            })),
            monthly_prices_brl: monthlyPricesBRL,
            setup_prices_brl:   setupPricesBRL,
            enabled_features: Array.from(features.values()),
            enabled_features_count: features.size,
            usage: {
                whatsapp_messages: whatsappUsage,
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}
