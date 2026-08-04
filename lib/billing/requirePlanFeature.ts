import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFeature } from "@/lib/billing/entitlements";

/** 403 se a empresa não tiver a feature no plano atual. */
export async function requirePlanFeature(
    admin: SupabaseClient,
    companyId: string,
    featureKey: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
    const allowed = await hasFeature(admin, companyId, featureKey);
    if (allowed) return { ok: true };
    return {
        ok: false,
        response: NextResponse.json(
            {
                error: "plan_feature_required",
                feature: featureKey,
                hint: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
            },
            { status: 403 }
        ),
    };
}
