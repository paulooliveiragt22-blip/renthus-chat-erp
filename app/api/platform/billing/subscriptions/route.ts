import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { SupabaseSubscriptionRepository } from "@/lib/billing/adapters/supabaseSubscriptionRepository";
import { SupabaseInvoiceRepository } from "@/lib/billing/adapters/supabaseInvoiceRepository";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import { ListSubscriptionsForPlatform } from "@/lib/billing/use-cases/listSubscriptionsForPlatform";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.billing.read", async (ctx) => {
        const subs = new SupabaseSubscriptionRepository(ctx.admin);
        const invoices = new SupabaseInvoiceRepository(ctx.admin);
        const notifier = new ConsoleBillingNotifier();

        const uc = new ListSubscriptionsForPlatform(subs, invoices, notifier);
        const subscriptions = await uc.execute({});

        return NextResponse.json({ subscriptions });
    });
}
