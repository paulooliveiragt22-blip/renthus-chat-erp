/**
 * GET /api/billing/webhook-health
 * Watchdog ADR-0004 B2 — alerta se houve checkout recente e zero webhooks.
 * Auth: CRON_SECRET Bearer.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const denied = validateCronAuthorization(
        req.headers.get("authorization"),
        { vercelCronHeader: req.headers.get("x-vercel-cron") }
    );
    if (denied) return denied;

    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: webhookCount }, { count: pendingWithOrder }] = await Promise.all([
        admin
            .from("pagarme_webhook_events")
            .select("*", { count: "exact", head: true })
            .gte("updated_at", since),
        admin
            .from("invoices")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
            .not("pagarme_order_id", "is", null)
            .gte("created_at", since),
    ]);

    const webhooks = webhookCount ?? 0;
    const pendingOrders = pendingWithOrder ?? 0;
    const unhealthy = pendingOrders > 0 && webhooks === 0;

    if (unhealthy) {
        Sentry.captureMessage("billing_webhook_health_zero_events", {
            level: "error",
            tags: { route: "billing-webhook-health" },
            extra: { pending_with_order_24h: pendingOrders, webhooks_24h: webhooks },
        });
    }

    return NextResponse.json({
        ok: true,
        unhealthy,
        webhooks_24h: webhooks,
        pending_invoices_with_order_24h: pendingOrders,
    });
}
