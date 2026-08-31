/**
 * GET /api/platform/billing/never-paid
 *
 * Lista tenants que NUNCA pagaram (para o super admin cobrar).
 *
 * Refactor hexagonal: usa o use case ListNeverPaidTenants que depende
 * dos ports (SubscriptionRepository, InvoiceRepository, BillingNotifier).
 */

import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { SupabaseSubscriptionRepository } from "@/lib/billing/adapters/supabaseSubscriptionRepository";
import { SupabaseInvoiceRepository } from "@/lib/billing/adapters/supabaseInvoiceRepository";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import { ListNeverPaidTenants } from "@/lib/billing/use-cases/listNeverPaidTenants";

export const runtime = "nodejs";

export async function GET(req: Request) {
    return withPlatformAccess("platform.billing.read", async (ctx) => {
        const url = new URL(req.url);
        const page = Number(url.searchParams.get("page") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");

        const subs = new SupabaseSubscriptionRepository(ctx.admin);
        const invoices = new SupabaseInvoiceRepository(ctx.admin);
        const notifier = new ConsoleBillingNotifier();

        const uc = new ListNeverPaidTenants(subs, invoices, notifier);
        const tenants = await uc.execute({ limit: Number.isFinite(limit) ? limit : 50 });

        return NextResponse.json({
            ok: true,
            billing: "never_paid",
            tenants,
            total: tenants.length,
            page,
            limit,
        });
    });
}
