import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

/**
 * GET /api/billing/features
 * Resposta leve só para gates de UI (plan_key + enabled_features).
 * Auth: qualquer membro ativo da empresa. Mutações continuam protegidas nas APIs de domínio.
 */
export async function GET() {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin", "member"],
            billing: "billing_self",
        });
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
        const { admin, companyId } = ctx;

        const [sub, features] = await Promise.all([
            getActiveSubscription(admin, companyId),
            getEnabledFeatures(admin, companyId),
        ]);

        return NextResponse.json({
            ok: true,
            company_id: companyId,
            plan_key: sub?.plan_key ?? null,
            enabled_features: Array.from(features.values()),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unexpected error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
