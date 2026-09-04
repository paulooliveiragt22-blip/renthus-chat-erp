import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPublicPlanOffers } from "@/lib/billing/listPublicPlanOffers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/public-plans
 * Vitrine pública (/signup). Sem auth. Não usar no ERP do tenant.
 */
export async function GET() {
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
