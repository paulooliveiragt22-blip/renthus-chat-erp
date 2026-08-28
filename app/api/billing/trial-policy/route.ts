/**
 * GET /api/billing/trial-policy
 *
 * Política pública de trial para copy do /signup (sem auth).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDefaultTrialDays } from "@/lib/billing/getDefaultTrialDays";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_15M_MS,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const TRIAL_POLICY_RATE_LIMIT = 60;

export async function GET(req: Request) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "billing_trial_policy",
        TRIAL_POLICY_RATE_LIMIT,
        RATE_LIMIT_WINDOW_15M_MS
    );
    if (limited) return limited;

    try {
        const admin = createAdminClient();
        const trialDays = await getDefaultTrialDays(admin);
        return NextResponse.json({
            trial_days:        trialDays,
            payment_required:  trialDays === 0,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[billing/trial-policy]", msg);
        return NextResponse.json(
            { trial_days: 0, payment_required: true },
            { status: 200 }
        );
    }
}
