/**
 * Dias de trial padrão para novos signups.
 * Fonte canônica: platform_billing_settings.default_trial_days (singleton).
 * Fallback: env TRIAL_DAYS (default 0).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { clampTrialDays, parseTrialDaysEnv } from "@/lib/billing/trialDaysPolicy";

type Admin = ReturnType<typeof createAdminClient>;

const SETTINGS_ROW_ID = 1;

export async function getDefaultTrialDays(admin: Admin): Promise<number> {
    const { data, error } = await admin
        .from("platform_billing_settings")
        .select("default_trial_days")
        .eq("id", SETTINGS_ROW_ID)
        .maybeSingle();

    if (!error && data?.default_trial_days != null) {
        return clampTrialDays(data.default_trial_days);
    }

    if (error) {
        console.warn(
            "[getDefaultTrialDays] platform_billing_settings:",
            error.message,
            "— usando env TRIAL_DAYS"
        );
    }

    return parseTrialDaysEnv(process.env.TRIAL_DAYS, 0);
}

/** @deprecated Use getDefaultTrialDays(admin) — mantido para imports legados até P2. */
export async function getTrialDays(admin: Admin): Promise<number> {
    return getDefaultTrialDays(admin);
}
