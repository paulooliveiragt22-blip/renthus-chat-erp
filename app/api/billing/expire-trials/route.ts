/**
 * POST /api/billing/expire-trials
 *
 * Cron diário (Vercel, 09:00 BRT) — vercel.json: "0 10 * * *" (UTC)
 *
 * Allowlist e efeito em rpc_expire_due_trials:
 * trial vencido → pending_payment (com plano) | pending_setup (sem plano)
 * + companies.is_active=false. Abandoned fica no cron mark-abandoned.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { billingLog } from "@/lib/billing/billingLog";
import { expireDueTrials } from "@/lib/billing/transitionBillingStatus";

export const runtime = "nodejs";

const EXPIRE_BATCH_LIMIT = 100;

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader, {
        vercelCronHeader: req.headers.get("x-vercel-cron"),
    });
    if (authError) return authError;

    const admin = createAdminClient();

    try {
        const result = await expireDueTrials(admin, EXPIRE_BATCH_LIMIT);

        billingLog("expire-trials", "expire_trials_done", {
            expired: result.expired,
            company_ids: result.companyIds,
        });

        return NextResponse.json({
            ok: true,
            expired: result.expired,
            alreadyExpired: 0,
            errors: [] as string[],
            company_ids: result.companyIds,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[expire-trials] RPC falhou:", msg);
        billingLog("expire-trials", "expire_trials_error", {
            phase: "rpc",
            error: msg,
        });
        Sentry.captureException(err, { tags: { route: "billing-expire-trials" } });
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
