import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPublicPlanOffers } from "@/lib/billing/listPublicPlanOffers";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_15M_MS,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_PLANS_RATE_LIMIT = 60;

/**
 * GET /api/billing/public-plans
 * Vitrine pública (/signup). Sem auth. Não usar no ERP do tenant.
 */
export async function GET(req: Request) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "billing_public_plans",
        PUBLIC_PLANS_RATE_LIMIT,
        RATE_LIMIT_WINDOW_15M_MS
    );
    if (limited) return limited;

    try {
        const admin = createAdminClient();
        const plans = await listPublicPlanOffers(admin);
        return NextResponse.json(
            { plans },
            {
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
