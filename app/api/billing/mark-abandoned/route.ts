/**
 * POST /api/billing/mark-abandoned
 *
 * Cron diário (Vercel, 08:00 BRT) — vercel.json: "0 9 * * *" (UTC)
 *
 * Grace e allowlist vivem em rpc_mark_abandoned_due (14 dias no SQL).
 * Abandoned: pending_setup|pending_payment, never-paid, empresa inativa, created_at + 14d.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { billingLog } from "@/lib/billing/billingLog";
import { markAbandonedDue } from "@/lib/billing/transitionBillingStatus";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader, {
        vercelCronHeader: req.headers.get("x-vercel-cron"),
    });
    if (authError) return authError;

    const admin = createAdminClient();

    try {
        const result = await markAbandonedDue(admin);

        billingLog("mark-abandoned", "mark_abandoned_done", {
            marked: result.marked,
            company_ids: result.companyIds,
        });

        return NextResponse.json({
            ok: true,
            marked: result.marked,
            alreadyAbandoned: 0,
            errors: [] as string[],
            company_ids: result.companyIds,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[mark-abandoned] RPC falhou:", msg);
        billingLog("mark-abandoned", "mark_abandoned_error", {
            phase: "rpc",
            error: msg,
        });
        Sentry.captureException(err, { tags: { route: "billing-mark-abandoned" } });
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
