import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

/** M6: cancela pending (+ processing stale). Não DELETE. */
export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        cancel_stale_processing?: boolean;
        stale_minutes?: number;
    };

    const { data, error } = await admin.rpc("rpc_clear_print_queue", {
        p_company_id: companyId,
        p_cancel_stale_processing: body.cancel_stale_processing !== false,
        p_stale_minutes:
            typeof body.stale_minutes === "number" && Number.isFinite(body.stale_minutes)
                ? Math.max(1, Math.floor(body.stale_minutes))
                : 15,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
