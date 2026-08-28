import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clampTrialDays } from "@/lib/billing/trialDaysPolicy";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformOpsAuditCtx } from "@/lib/platform/services/platformOps";

export type PlatformBillingSettingsRow = {
    default_trial_days: number;
    updated_at:         string;
    updated_by:         string | null;
};

const SETTINGS_ROW_ID = 1;

export async function getPlatformBillingSettings(
    admin: SupabaseClient
): Promise<PlatformBillingSettingsRow> {
    const { data, error } = await admin
        .from("platform_billing_settings")
        .select("default_trial_days, updated_at, updated_by")
        .eq("id", SETTINGS_ROW_ID)
        .maybeSingle();

    if (error) throw new Error(error.message);

    if (!data) {
        return {
            default_trial_days: 0,
            updated_at:         new Date().toISOString(),
            updated_by:         null,
        };
    }

    return {
        default_trial_days: clampTrialDays(data.default_trial_days),
        updated_at:         String(data.updated_at),
        updated_by:         data.updated_by ? String(data.updated_by) : null,
    };
}

export async function updatePlatformBillingSettings(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    defaultTrialDays: number
): Promise<PlatformBillingSettingsRow> {
    const days = clampTrialDays(defaultTrialDays);
    const before = await getPlatformBillingSettings(admin);

    const { data, error } = await admin
        .from("platform_billing_settings")
        .upsert(
            {
                id:                 SETTINGS_ROW_ID,
                default_trial_days: days,
                updated_at:         new Date().toISOString(),
                updated_by:         audit.actor.id,
            },
            { onConflict: "id" }
        )
        .select("default_trial_days, updated_at, updated_by")
        .single();

    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor:        audit.actor,
        action:       "platform.billing.settings_updated",
        resourceType: "platform_billing_settings",
        resourceId:   String(SETTINGS_ROW_ID),
        requestId:    audit.requestId,
        ipAddress:    audit.ipAddress,
        userAgent:    audit.userAgent,
        beforeState:  { default_trial_days: before.default_trial_days },
        afterState:   { default_trial_days: days },
    });

    return {
        default_trial_days: clampTrialDays(data.default_trial_days),
        updated_at:         String(data.updated_at),
        updated_by:         data.updated_by ? String(data.updated_by) : null,
    };
}
