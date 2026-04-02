import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures, checkLimit } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMonthlyPriceCents, listCustomerCards } from "@/lib/billing/pagarme";

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

        // Última fatura pendente (PIX) — qualquer status (trial, active, overdue, blocked)
        let pendingInvoice: {
            pagarme_payment_url: string | null;
            pix_qr_code:         string | null;
            amount:              number;
            due_at:              string;
        } | null = null;
        const { data: invPending } = await admin
            .from("invoices")
            .select("pagarme_payment_url, pix_qr_code, amount, due_at")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        pendingInvoice = invPending ?? null;

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
            bot:      getMonthlyPriceCents("bot") / 100,
            complete: getMonthlyPriceCents("complete") / 100,
        };

        return NextResponse.json({
            ok: true,
            company_id: companyId,
            subscription: sub,
            pagarme_subscription: pagarmeSubRaw ?? null,
            pending_invoice: pendingInvoice,
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
