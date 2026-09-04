import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";
import { parseCommercialPlanInput } from "@/lib/billing/planCatalog";

export const runtime = "nodejs";

/**
 * GET /api/billing/members-for-downgrade?plan=pro
 * Lista members ativos + limite do plano destino (para UI de keep).
 */
export async function GET(req: Request) {
    const ctx = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        billing: "billing_self",
    });
    if (!ctx.ok) return jsonAccessError(ctx);

    const planParam = new URL(req.url).searchParams.get("plan");
    const target = parseCommercialPlanInput(planParam);
    if (!target) {
        return NextResponse.json({ error: "Informe plan=essencial|pro|market" }, { status: 400 });
    }

    const pricing = await loadPlanPricing(ctx.admin, target);

    const { data: rows, error } = await ctx.admin
        .from("company_users")
        .select("user_id, role, is_active")
        .eq("company_id", ctx.companyId)
        .eq("is_active", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const members = await Promise.all(
        (rows ?? []).map(async (r) => {
            let email: string | null = null;
            try {
                const { data: u } = await ctx.admin.auth.admin.getUserById(String(r.user_id));
                email = u.user?.email ?? null;
            } catch {
                email = null;
            }
            return {
                user_id: String(r.user_id),
                role: String(r.role ?? "member"),
                email,
                name: null as string | null,
                is_active: true,
            };
        })
    );

    return NextResponse.json({
        ok: true,
        target_plan: target,
        target_included_seats: pricing.includedSeats,
        members,
    });
}
