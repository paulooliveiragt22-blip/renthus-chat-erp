import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { cancelPendingPlanChange } from "@/lib/billing/scheduleDowngrade";
import { getPlanLabel, normalizePlanKey } from "@/lib/billing/planCatalog";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

/** GET — status do downgrade agendado. */
export async function GET() {
    const ctx = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        billing: "billing_self",
    });
    if (!ctx.ok) return jsonAccessError(ctx);

    const { data, error } = await ctx.admin
        .from("pagarme_subscriptions")
        .select(
            "plan, pending_plan_key, pending_plan_change_at, pending_keep_user_ids, next_billing_at"
        )
        .eq("company_id", ctx.companyId)
        .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const pendingKey = normalizePlanKey(
        (data as { pending_plan_key?: string | null } | null)?.pending_plan_key ?? null
    );
    if (!pendingKey) {
        return NextResponse.json({ ok: true, pending: null });
    }

    return NextResponse.json({
        ok: true,
        pending: {
            pending_plan_key: pendingKey,
            pending_plan_label: getPlanLabel(pendingKey),
            pending_plan_change_at: (data as { pending_plan_change_at?: string | null })
                ?.pending_plan_change_at,
            pending_keep_user_ids:
                (data as { pending_keep_user_ids?: string[] | null })?.pending_keep_user_ids ??
                [],
            current_plan_key: normalizePlanKey(
                (data as { plan?: string })?.plan ?? null
            ),
            next_billing_at: (data as { next_billing_at?: string | null })?.next_billing_at,
        },
    });
}

/** DELETE — cancela agendamento (BN-12). */
export async function DELETE() {
    const ctx = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        billing: "billing_self",
    });
    if (!ctx.ok) return jsonAccessError(ctx);

    const result = await cancelPendingPlanChange(ctx.admin, ctx.companyId);
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, action: "cancelled" });
}
